import { Router, type IRouter } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import { resumesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  buildResumeObjectPath,
  uploadResumeObject,
  getResumeSignedUrl,
  deleteResumeObject,
} from "../lib/resumeStorage.js";
import { chatComplete, chatCompleteJSON } from "../lib/openrouter.js";
import { chargeOr402 } from "../lib/featureCredits.js";
import {
  getResumeContextById,
  getResumeContextText,
  getResumeById,
  fieldsToText,
} from "../lib/resumeContext.js";

const router: IRouter = Router();

interface ATSResult {
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  missingKeywords: string[];
  suggestions: string[];
}

async function scoreResumeText(resumeText: string, jobDescription?: string): Promise<ATSResult> {
  const prompt = [
    "You are an ATS (Applicant Tracking System) resume scorer.",
    `Resume:\n${resumeText || "(no resume text available)"}`,
    jobDescription ? `Target job description:\n${jobDescription}` : "",
    'Respond with ONLY a JSON object: { "score": number (0-100), "summary": string, "strengths": string[], "weaknesses": string[], "missingKeywords": string[], "suggestions": string[] }. No other text.',
  ]
    .filter(Boolean)
    .join("\n\n");

  return chatCompleteJSON<ATSResult>({ messages: [{ role: "user", content: prompt }], maxTokens: 1500 });
}

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, DOC, and DOCX files are allowed"));
    }
  },
});

function toFrontendResume(r: typeof resumesTable.$inferSelect) {
  return {
    id: r.id,
    userId: r.userId,
    filename: r.filename,
    path: r.path,
    size: r.size,
    resumeContext: r.resumeContext,
    source: r.source,
    ats: r.ats,
    score: r.score,
    title: r.title,
    templateId: r.templateId,
    status: r.status,
    content: r.fields,
    uploadedAt: r.createdAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const uploadSingleResume: import("express").RequestHandler = (req, res, next) => {
  upload.single("resume")(req, res, (err: unknown) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "File too large (max 10MB)"
          : err instanceof Error
            ? err.message
            : "Upload failed";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
};

router.post("/upload", requireAuth, uploadSingleResume, async (req, res) => {
  try {
    const userId = req.userId!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const resumeId = uuidv4();
    const objectPath = buildResumeObjectPath(userId, file.originalname);
    await uploadResumeObject(objectPath, file.buffer, file.mimetype);

    await db.insert(resumesTable).values({
      id: resumeId,
      userId,
      filename: file.originalname,
      path: objectPath,
      size: file.size,
      source: "uploaded",
      ats: false,
    });

    const [resume] = await db
      .select()
      .from(resumesTable)
      .where(eq(resumesTable.id, resumeId))
      .limit(1);

    res.status(201).json({ success: true, data: toFrontendResume(resume!) });
  } catch (err) {
    console.error("[resumes] upload error", err);
    res.status(500).json({ error: "Failed to upload resume" });
  }
});

router.get("/list", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;

    const resumes = await db
      .select()
      .from(resumesTable)
      .where(
        and(
          eq(resumesTable.userId, userId),
          eq(resumesTable.source, "uploaded"),
        ),
      );

    res.json(resumes.map(toFrontendResume));
  } catch (err) {
    console.error("[resumes] list error", err);
    res.status(500).json({ error: "Failed to fetch resumes" });
  }
});

router.get("/:id/signed-url", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const resumeId = String(req.params["id"] ?? "");

    const [resume] = await db
      .select()
      .from(resumesTable)
      .where(and(eq(resumesTable.id, resumeId), eq(resumesTable.userId, userId)))
      .limit(1);

    if (!resume || !resume.path) {
      res.status(404).json({ error: "Resume not found" });
      return;
    }

    // Defense-in-depth: the stored object path must live under the user's folder.
    if (!resume.path.startsWith(`${userId}/`)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const url = await getResumeSignedUrl(resume.path);
    res.json({ url });
  } catch (err) {
    console.error("[resumes] signed-url error", err);
    res.status(500).json({ error: "Failed to generate download link" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const resumeId = String(req.params["id"] ?? "");

    const [resume] = await db
      .select()
      .from(resumesTable)
      .where(and(eq(resumesTable.id, resumeId), eq(resumesTable.userId, userId)))
      .limit(1);

    if (!resume) {
      res.status(404).json({ error: "Resume not found" });
      return;
    }

    if (resume.path && resume.source === "uploaded") {
      try {
        await deleteResumeObject(resume.path);
      } catch (storageErr) {
        console.error("[resumes] storage delete error", storageErr);
      }
    }

    await db.delete(resumesTable).where(and(eq(resumesTable.id, resumeId), eq(resumesTable.userId, userId)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete resume" });
  }
});

router.post("/ats-score", requireAuth, async (req, res) => {
  try {
    const body = req.body as { resumeId?: string; jobDescription?: string };
    if (!body.resumeId) {
      res.status(400).json({ error: "resumeId is required" });
      return;
    }

    const resume = await getResumeById(body.resumeId, req.userId!);
    if (!resume) {
      res.status(404).json({ error: "Resume not found" });
      return;
    }

    const resumeText = await getResumeContextText(resume);
    const result = await scoreResumeText(resumeText, body.jobDescription);

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_ats",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: resume.id,
    });
    if (!_meter) return;

    await db
      .update(resumesTable)
      .set({ ats: true, score: result.score })
      .where(eq(resumesTable.id, resume.id));

    res.json({ ...result, ..._meter });
  } catch (err) {
    console.error("[resumes] ats-score error", err);
    res.status(500).json({ error: "Failed to score resume" });
  }
});

router.get("/all-ats", requireAuth, async (req, res) => {
  res.json({ data: [] });
});

router.post("/generate-cover-letter", requireAuth, async (req, res) => {
  try {
    const body = req.body as {
      resumeId?: string;
      jobRole?: string;
      company?: string;
      jobDescription?: string;
      tone?: string;
    };

    const resumeText = await getResumeContextById(body.resumeId, req.userId!);

    const prompt = [
      "Write a professional cover letter for this candidate.",
      body.jobRole ? `Job role: ${body.jobRole}` : "",
      body.company ? `Company: ${body.company}` : "",
      body.jobDescription ? `Job description:\n${body.jobDescription}` : "",
      body.tone ? `Tone: ${body.tone}` : "Tone: professional",
      resumeText ? `Candidate's resume:\n${resumeText}` : "",
      "Respond with ONLY the cover letter text, no other commentary.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const coverLetter = await chatComplete({ messages: [{ role: "user", content: prompt }], maxTokens: 1200 });

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_cover_letter",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: body.resumeId ?? null,
    });
    if (!_meter) return;

    res.json({ coverLetter, ..._meter });
  } catch (err) {
    console.error("[resumes] generate-cover-letter error", err);
    res.status(500).json({ error: "Failed to generate cover letter" });
  }
});

router.get("/all-templates", requireAuth, async (_req, res) => {
  res.json({ data: [] });
});

// ── Resume Builder ────────────────────────────────────────────────────────────

router.post("/builder/save", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as {
      id?: string;
      filename?: string;
      title?: string;
      templateId?: string;
      status?: string;
      content?: Record<string, unknown>;
    };

    const resumeId = body.id ?? uuidv4();
    const filename = body.filename ?? body.title ?? "My Resume";

    const existing = await db
      .select()
      .from(resumesTable)
      .where(eq(resumesTable.id, resumeId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(resumesTable)
        .set({
          filename,
          title: body.title ?? filename,
          ...(body.templateId ? { templateId: body.templateId } : {}),
          ...(body.status ? { status: body.status } : {}),
          ...(body.content ? { fields: body.content } : {}),
          updatedAt: new Date(),
        })
        .where(eq(resumesTable.id, resumeId));
    } else {
      await db.insert(resumesTable).values({
        id: resumeId,
        userId,
        filename,
        title: body.title ?? filename,
        templateId: body.templateId ?? null,
        status: body.status ?? "draft",
        fields: body.content ?? null,
        path: "",
        source: "builder",
        ats: false,
      });
    }

    const [resume] = await db
      .select()
      .from(resumesTable)
      .where(eq(resumesTable.id, resumeId))
      .limit(1);

    res.json({ success: true, data: toFrontendResume(resume!) });
  } catch (err) {
    res.status(500).json({ error: "Failed to save resume" });
  }
});

router.get("/builder/list", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;

    const resumes = await db
      .select()
      .from(resumesTable)
      .where(
        and(
          eq(resumesTable.userId, userId),
          eq(resumesTable.source, "builder"),
        ),
      );

    res.json(resumes.map(toFrontendResume));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch builder resumes" });
  }
});

router.get("/builder/:id", requireAuth, async (req, res) => {
  try {
    const resumeId = String(req.params["id"] ?? "");
    const [resume] = await db
      .select()
      .from(resumesTable)
      .where(eq(resumesTable.id, resumeId))
      .limit(1);

    if (!resume) {
      res.status(404).json({ error: "Resume not found" });
      return;
    }

    res.json({ success: true, data: toFrontendResume(resume) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch resume" });
  }
});

router.delete("/builder/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const resumeId = String(req.params["id"] ?? "");

    await db
      .delete(resumesTable)
      .where(and(eq(resumesTable.id, resumeId), eq(resumesTable.userId, userId)));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete resume" });
  }
});

router.post("/builder/:id/complete", requireAuth, async (req, res) => {
  res.json({ success: true });
});

const RESUME_FIELDS_SCHEMA = `{
  "name": string, "role": string, "email": string, "phone": string, "location": string, "links": string,
  "summary": string, "experience": string, "skillsLanguages": string, "skillsFrameworks": string,
  "skillsDatabases": string, "skillsTools": string, "projects": string, "education": string,
  "certifications": string, "publications": string
}`;

/** Resolves resume text from either an inline `fields` object or a `resumeId` lookup. */
async function resolveFieldsText(
  body: { resumeId?: string; fields?: Record<string, unknown> },
  userId: string,
): Promise<string> {
  if (body.resumeId) return getResumeContextById(body.resumeId, userId);
  if (body.fields) return fieldsToText(body.fields);
  return "";
}

router.post("/builder/generate", requireAuth, async (req, res) => {
  try {
    const body = req.body as {
      jobTitle?: string;
      company?: string;
      jobDescription?: string;
      fields?: Record<string, unknown>;
    };

    const prompt = [
      "Generate a complete, strong resume for this candidate as a flat JSON object of resume fields.",
      body.jobTitle ? `Target role: ${body.jobTitle}` : "",
      body.company ? `Target company: ${body.company}` : "",
      body.jobDescription ? `Job description:\n${body.jobDescription}` : "",
      body.fields && Object.keys(body.fields).length > 0
        ? `Existing fields to build on:\n${fieldsToText(body.fields)}`
        : "",
      `Respond with ONLY a JSON object matching this shape: ${RESUME_FIELDS_SCHEMA}. No other text.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const fields = await chatCompleteJSON<Record<string, unknown>>({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 2500,
    });

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_generate",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: null,
    });
    if (!_meter) return;
    res.json({ success: true, data: { fields, ..._meter } });
  } catch (err) {
    console.error("[resumes] builder/generate error", err);
    res.status(500).json({ error: "Failed to generate resume" });
  }
});

router.post("/builder/extract-fields", requireAuth, async (req, res) => {
  try {
    const body = req.body as { resumeId?: string; text?: string };
    const resumeText = body.text || (await getResumeContextById(body.resumeId, req.userId!));

    if (!resumeText) {
      res.status(400).json({ error: "No resume text available to extract from" });
      return;
    }

    const prompt = [
      "Extract structured resume fields from this resume text.",
      `Resume text:\n${resumeText}`,
      `Respond with ONLY a JSON object matching this shape: ${RESUME_FIELDS_SCHEMA}. No other text.`,
    ].join("\n\n");

    const fields = await chatCompleteJSON<Record<string, unknown>>({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 2500,
    });

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_extract_fields",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: body.resumeId ?? null,
    });
    if (!_meter) return;
    res.json({ success: true, data: { fields, ..._meter } });
  } catch (err) {
    console.error("[resumes] builder/extract-fields error", err);
    res.status(500).json({ error: "Failed to extract fields" });
  }
});

router.post("/builder/enhance-section", requireAuth, async (req, res) => {
  try {
    const body = req.body as { sectionId?: string; currentText?: string; jobDescription?: string };

    const prompt = [
      `Improve this resume section ("${body.sectionId || "section"}") — make it more impactful, quantified, and concise.`,
      body.jobDescription ? `Target job description:\n${body.jobDescription}` : "",
      `Current text:\n${body.currentText || ""}`,
      "Respond with ONLY the improved section text, no other commentary.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const text = await chatComplete({ messages: [{ role: "user", content: prompt }], maxTokens: 800 });

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_enhance_section",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: null,
    });
    if (!_meter) return;
    res.json({ success: true, data: { text, ..._meter } });
  } catch (err) {
    console.error("[resumes] builder/enhance-section error", err);
    res.status(500).json({ error: "Failed to enhance section" });
  }
});

router.post("/builder/validate-section", requireAuth, async (req, res) => {
  res.json({ success: true, data: { valid: true, issues: [] } });
});

router.post("/builder/ats-score", requireAuth, async (req, res) => {
  try {
    const body = req.body as { resumeId?: string; jobDescription?: string };
    if (!body.resumeId) {
      res.status(400).json({ error: "resumeId is required" });
      return;
    }

    const resume = await getResumeById(body.resumeId, req.userId!);
    if (!resume) {
      res.status(404).json({ error: "Resume not found" });
      return;
    }

    const resumeText = await getResumeContextText(resume);
    const result = await scoreResumeText(resumeText, body.jobDescription);

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_ats",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: resume.id,
    });
    if (!_meter) return;

    await db
      .update(resumesTable)
      .set({ ats: true, score: result.score })
      .where(eq(resumesTable.id, resume.id));

    res.json({ success: true, data: { ...result, ..._meter } });
  } catch (err) {
    console.error("[resumes] builder/ats-score error", err);
    res.status(500).json({ error: "Failed to score resume" });
  }
});

router.post("/builder/tailor", requireAuth, async (req, res) => {
  try {
    const body = req.body as {
      jobDescription?: string;
      jobTitle?: string;
      company?: string;
      resumeId?: string;
      fields?: Record<string, unknown>;
    };

    if (!body.jobDescription) {
      res.status(400).json({ error: "jobDescription is required" });
      return;
    }

    const resumeText = await resolveFieldsText(body, req.userId!);

    const prompt = [
      "Tailor this candidate's resume fields to better match the target job description.",
      body.jobTitle ? `Target role: ${body.jobTitle}` : "",
      body.company ? `Target company: ${body.company}` : "",
      `Job description:\n${body.jobDescription}`,
      `Current resume:\n${resumeText || "(none provided)"}`,
      'Respond with ONLY a JSON object: { "tailoredFields": { <only the resume field keys that changed, as strings> }, "keywordsMatched": string[], "keywordsMissing": string[], "matchScore": number (0-100) }. No other text.',
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await chatCompleteJSON<{
      tailoredFields: Record<string, unknown>;
      keywordsMatched: string[];
      keywordsMissing: string[];
      matchScore: number;
    }>({ messages: [{ role: "user", content: prompt }], maxTokens: 2500 });

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_tailor",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: body.resumeId ?? null,
    });
    if (!_meter) return;
    res.json({ success: true, data: { ...result, ..._meter } });
  } catch (err) {
    console.error("[resumes] builder/tailor error", err);
    res.status(500).json({ error: "Failed to tailor resume" });
  }
});

router.post("/builder/export-pdf", requireAuth, async (req, res) => {
  res.status(501).json({ error: "PDF export requires configuration" });
});

router.post("/builder/rewrite", requireAuth, async (req, res) => {
  try {
    const body = req.body as { sectionId?: string; currentText?: string; instruction?: string };

    const prompt = [
      `Rewrite this resume ${body.sectionId ? `"${body.sectionId}" section` : "text"}.`,
      body.instruction ? `Instruction: ${body.instruction}` : "Make it clearer, more professional, and more impactful.",
      `Current text:\n${body.currentText || ""}`,
      "Respond with ONLY the rewritten text, no other commentary.",
    ].join("\n\n");

    const text = await chatComplete({ messages: [{ role: "user", content: prompt }], maxTokens: 800 });

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_rewrite",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: null,
    });
    if (!_meter) return;
    res.json({ success: true, data: { text, ..._meter } });
  } catch (err) {
    console.error("[resumes] builder/rewrite error", err);
    res.status(500).json({ error: "Failed to rewrite text" });
  }
});

router.post("/builder/inject-skills", requireAuth, async (req, res) => {
  try {
    const body = req.body as {
      resumeId?: string;
      fields?: Record<string, unknown>;
      jobDescription?: string;
    };

    const resumeText = await resolveFieldsText(body, req.userId!);

    const prompt = [
      "Suggest skills to add to this candidate's resume, grouped by category.",
      body.jobDescription ? `Target job description:\n${body.jobDescription}` : "",
      `Current resume:\n${resumeText || "(none provided)"}`,
      'Respond with ONLY a JSON object: { "skillsLanguages": string, "skillsFrameworks": string, "skillsDatabases": string, "skillsTools": string }, each a comma-separated list (including existing skills plus new suggestions). No other text.',
    ]
      .filter(Boolean)
      .join("\n\n");

    const fields = await chatCompleteJSON<Record<string, unknown>>({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 800,
    });

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_inject_skills",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: body.resumeId ?? null,
    });
    if (!_meter) return;
    res.json({ success: true, data: { fields, ..._meter } });
  } catch (err) {
    console.error("[resumes] builder/inject-skills error", err);
    res.status(500).json({ error: "Failed to suggest skills" });
  }
});

router.post("/builder/inject-keywords", requireAuth, async (req, res) => {
  try {
    const body = req.body as {
      sectionId?: string;
      currentText?: string;
      jobDescription?: string;
      keywords?: string[];
    };

    const prompt = [
      "Naturally weave the following keywords into this resume section, without making it sound stuffed or unnatural.",
      body.keywords?.length
        ? `Keywords: ${body.keywords.join(", ")}`
        : body.jobDescription
          ? `Extract and weave in the most important keywords from this job description:\n${body.jobDescription}`
          : "",
      `Current text:\n${body.currentText || ""}`,
      "Respond with ONLY the revised text, no other commentary.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const text = await chatComplete({ messages: [{ role: "user", content: prompt }], maxTokens: 800 });

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_inject_keywords",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: null,
    });
    if (!_meter) return;
    res.json({ success: true, data: { text, ..._meter } });
  } catch (err) {
    console.error("[resumes] builder/inject-keywords error", err);
    res.status(500).json({ error: "Failed to inject keywords" });
  }
});

router.post("/builder/analyze-keywords", requireAuth, async (req, res) => {
  try {
    const body = req.body as {
      resumeId?: string;
      fields?: Record<string, unknown>;
      jobDescription?: string;
    };

    if (!body.jobDescription) {
      res.status(400).json({ error: "jobDescription is required" });
      return;
    }

    const resumeText = await resolveFieldsText(body, req.userId!);

    const prompt = [
      "Compare this resume against the job description and identify keyword overlap and gaps.",
      `Job description:\n${body.jobDescription}`,
      `Resume:\n${resumeText || "(none provided)"}`,
      'Respond with ONLY a JSON object: { "matched": string[], "missing": string[], "matchScore": number (0-100) }. No other text.',
    ].join("\n\n");

    const result = await chatCompleteJSON<{ matched: string[]; missing: string[]; matchScore: number }>({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1000,
    });

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_analyze_keywords",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: body.resumeId ?? null,
    });
    if (!_meter) return;
    res.json({ success: true, data: { ...result, ..._meter } });
  } catch (err) {
    console.error("[resumes] builder/analyze-keywords error", err);
    res.status(500).json({ error: "Failed to analyze keywords" });
  }
});

router.post("/builder/keyword-match", requireAuth, async (req, res) => {
  try {
    const body = req.body as {
      resumeId?: string;
      fields?: Record<string, unknown>;
      jobDescription?: string;
    };

    if (!body.jobDescription) {
      res.status(400).json({ error: "jobDescription is required" });
      return;
    }

    const resumeText = await resolveFieldsText(body, req.userId!);

    const prompt = [
      "Score how well this resume matches the job description's keywords.",
      `Job description:\n${body.jobDescription}`,
      `Resume:\n${resumeText || "(none provided)"}`,
      'Respond with ONLY a JSON object: { "matchScore": number (0-100), "matched": string[], "missing": string[] }. No other text.',
    ].join("\n\n");

    const result = await chatCompleteJSON<{ matchScore: number; matched: string[]; missing: string[] }>({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1000,
    });

    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "resume_keyword_match",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: body.resumeId ?? null,
    });
    if (!_meter) return;

    res.json({ success: true, data: { ...result, ..._meter } });
  } catch (err) {
    console.error("[resumes] builder/keyword-match error", err);
    res.status(500).json({ error: "Failed to match keywords" });
  }
});

export default router;
