import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import { projectsTable, projectVersionsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { chatCompleteJSON } from "../lib/openrouter.js";
import { getResumeContextById } from "../lib/resumeContext.js";
import { chargeOr402, withCharge } from "../lib/featureCredits.js";
import { renderHtmlToPdf, PdfError } from "../lib/htmlPdf.js";

const router: IRouter = Router();

const PROJECT_END_DELIMITER = "|||PROJECT_END|||";

const PROJECT_GENERATION_TOKEN_BUDGETS = [6000, 1200, 900, 700, 500] as const;
const PROJECT_REGEN_TOKEN_BUDGETS = [4000, 1200, 900, 700, 500] as const;

function isRetryableModelFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("(402)") ||
    message.includes("No JSON found") ||
    message.includes("Unterminated JSON")
  );
}

function buildFallbackProjects(input: {
  position: string;
  industry: string;
  experienceLevel: string;
  generationMode: "new" | "resume_enhanced";
}): Record<string, unknown>[] {
  const position = input.position || "Software Engineer";
  const industry = input.industry || "Technology";
  const experienceLevel = input.experienceLevel || "Mid-level";

  const templates = [
    {
      title: `${position} Analytics Platform`,
      domain: industry,
      tagline: "Built a production-grade analytics workflow for business reporting",
      context: "A growing team needed faster insights from fragmented operational data.",
      problem: "Manual reporting caused delays and inconsistent metrics across teams.",
      components: ["Ingestion service", "Transform jobs", "Dashboard API", "Web dashboard"],
    },
    {
      title: `${industry} Workflow Automation Suite`,
      domain: industry,
      tagline: "Automated repetitive workflows to improve turnaround and reliability",
      context: "Operations depended on email and spreadsheet driven handoffs.",
      problem: "High coordination overhead and frequent process bottlenecks.",
      components: ["Rules engine", "Queue worker", "Notification service", "Admin console"],
    },
    {
      title: `${position} Performance Optimization Initiative`,
      domain: industry,
      tagline: "Improved scale, stability, and developer velocity for core systems",
      context: "Core services experienced latency spikes during traffic peaks.",
      problem: "Slow API responses impacted user experience and conversion.",
      components: ["Caching layer", "API gateway", "Observability stack", "Load testing suite"],
    },
  ];

  return templates.map((t, idx) => ({
    projectHeader: {
      title: t.title,
      tagline: t.tagline,
      domain: t.domain,
      duration: "4-6 months",
      teamSize: "4-6 engineers",
    },
    introduction: {
      summary: `${experienceLevel} ${position} led delivery of a high-impact project in ${industry}.`,
      context: t.context,
    },
    businessPurpose: {
      problemStatement: t.problem,
      successCriteria: [
        "Reduce cycle time by at least 30%",
        "Improve reliability and consistency of outputs",
      ],
    },
    architecture: {
      overview: "Service-oriented architecture with modular APIs and clear data contracts.",
      components: t.components,
    },
    databaseSchema: [
      "users(id, role, created_at)",
      "projects(id, owner_id, status, created_at)",
      "events(id, project_id, event_type, payload, created_at)",
    ],
    clusterAndNodes: {
      infrastructure: "Containerized services behind a reverse proxy with managed database.",
      details: [
        "App and worker services in separate containers",
        "PostgreSQL for transactional data",
        "Centralized logs and metrics dashboard",
      ],
    },
    ciCdPipeline: [
      "Pull request checks with lint and typecheck",
      "Automated build and image publish",
      "Staged rollout with health checks",
    ],
    codeSnippets: [
      {
        label: "Service handler",
        language: "TypeScript",
        code: "export async function handler(input) { return { ok: true, input }; }",
      },
    ],
    challengesAndResolutions: [
      {
        challenge: "Balancing rapid delivery with maintainable architecture.",
        resolution: "Introduced phased milestones, strict API contracts, and shared coding standards.",
      },
    ],
    keyAchievements: [
      "Delivered MVP on schedule with measurable performance improvements",
      "Reduced operational overhead through automation",
      "Improved team development speed with reusable modules",
    ],
    technicalLearnings: [
      "Design for observability from day one",
      "Keep interfaces stable as systems evolve",
      "Use incremental releases for risk control",
    ],
    howToExplain: {
      elevatorPitch: `I delivered a ${industry} project that improved speed, reliability, and business outcomes.`,
      detailedExplanation:
        "I defined requirements, designed a modular architecture, implemented core services, and validated outcomes through metrics and staged rollout.",
    },
    metadata: {
      source: "local_fallback",
      generationMode: input.generationMode,
      templateIndex: idx + 1,
    },
  }));
}

async function chatCompleteJSONWithBudgets<T>(
  prompt: string,
  budgets: readonly number[],
): Promise<T> {
  let lastError: unknown;

  for (const maxTokens of budgets) {
    try {
      return await chatCompleteJSON<T>({
        messages: [{ role: "user", content: prompt }],
        maxTokens,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableModelFailure(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to generate valid model response after retries");
}

const PROJECT_SCHEMA_DESCRIPTION = `Each project object must have exactly this shape:
{
  "projectHeader": { "title": string, "tagline": string, "domain": string, "duration": string, "teamSize": string },
  "introduction": { "summary": string, "context": string },
  "businessPurpose": { "problemStatement": string, "successCriteria": string[] },
  "architecture": { "overview": string, "components": string[] },
  "databaseSchema": string[],
  "clusterAndNodes": { "infrastructure": string, "details": string[] },
  "ciCdPipeline": string[],
  "codeSnippets": [{ "label": string, "language": string, "code": string }],
  "challengesAndResolutions": [{ "challenge": string, "resolution": string }],
  "keyAchievements": string[],
  "technicalLearnings": string[],
  "howToExplain": { "elevatorPitch": string, "detailedExplanation": string }
}`;

router.post("/generate", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as {
      resumeId?: string;
      sector?: string;
      position?: string;
      industry?: string;
      experienceLevel?: string;
      jobDescription?: string;
      generationMode?: "new" | "resume_enhanced";
    };

    if (!body.resumeId) {
      res.status(400).json({ error: "resumeId is required" });
      return;
    }

    const resumeContext = await getResumeContextById(body.resumeId, req.userId!);
    if (!resumeContext) {
      res.status(400).json({ error: "Selected resume not found or unavailable" });
      return;
    }

    // Charge upfront, before any streaming headers are flushed — this endpoint
    // streams its results so it can't carry the JSON meter in a body, and a
    // late 402 mid-stream would be unreadable by the client. Idempotency-Key
    // makes a retried generation a no-op charge. On insufficient credits the
    // client's !res.ok branch shows the error toast.
    const _meter = await chargeOr402(res, {
      userId,
      operation: "project_generate",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      resumeId: body.resumeId,
    });
    if (!_meter) return;

    const normalizedIndustry = (body.industry || body.sector || "").trim();
    const normalizedPosition = (body.position || "").trim();
    const normalizedExperience = (body.experienceLevel || "").trim();
    const normalizedJobDescription = (body.jobDescription || "").trim();
    const generationMode = body.generationMode || "new";

    const prompt = [
      "Generate exactly 3 realistic, resume-worthy software/data projects this candidate could have built, tailored to their background.",
      `Generation mode: ${generationMode}`,
      normalizedPosition ? `Target position (optional hint): ${normalizedPosition}` : "",
      normalizedIndustry ? `Target sector/domain (optional hint): ${normalizedIndustry}` : "",
      normalizedExperience ? `Experience level (optional hint): ${normalizedExperience}` : "",
      normalizedJobDescription
        ? `Job description (optional hint):\n${normalizedJobDescription}`
        : "No job description was provided. Infer realistic project direction from the resume only.",
      `Candidate's resume:\n${resumeContext}`,
      "When optional hints are missing, infer details from the resume and avoid asking follow-up questions.",
      "Keep output concise to fit low token budgets: each list should have 2-4 bullets and code snippets should be short.",
      PROJECT_SCHEMA_DESCRIPTION,
      'Respond with ONLY a JSON array of 3 such project objects, no other text.',
    ]
      .filter(Boolean)
      .join("\n\n");

    let projects: Record<string, unknown>[];
    try {
      projects = await chatCompleteJSONWithBudgets<Record<string, unknown>[]>(
        prompt,
        PROJECT_GENERATION_TOKEN_BUDGETS,
      );
    } catch (error) {
      if (!isRetryableModelFailure(error)) {
        throw error;
      }
      projects = buildFallbackProjects({
        position: normalizedPosition,
        industry: normalizedIndustry,
        experienceLevel: normalizedExperience,
        generationMode,
      });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    for (const project of projects.slice(0, 3)) {
      const id = uuidv4();
      const header = project["projectHeader"] as { title?: string } | undefined;
      const intro = project["introduction"] as { summary?: string } | undefined;

      await db.insert(projectsTable).values({
        id,
        userId,
        title: header?.title || "Untitled Project",
        description: intro?.summary || null,
        roleType: normalizedIndustry || null,
        content: project,
      });
      await db.insert(projectVersionsTable).values({
        id: uuidv4(),
        projectId: id,
        version: 1,
        content: project,
      });

      res.write(JSON.stringify({ ...project, id }));
      res.write(`${PROJECT_END_DELIMITER}\n`);
    }

    res.end();
  } catch (err) {
    console.error("[projects] generate error", err);
    if (res.headersSent) {
      res.end();
    } else {
      res.status(500).json({ error: "Failed to generate projects" });
    }
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const projects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId))
      .orderBy(desc(projectsTable.updatedAt));

    res.json({ success: true, data: projects });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

router.get("/user/:userId", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const projects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId))
      .orderBy(desc(projectsTable.updatedAt));

    res.json({ success: true, data: projects });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const projectId = String(req.params["id"] ?? "");
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json({ success: true, data: project });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const projectId = String(req.params["id"] ?? "");

    await db
      .delete(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete project" });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const projectId = String(req.params["id"] ?? "");
    const body = req.body as { title?: string; description?: string; content?: unknown };

    await db
      .update(projectsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)));

    // Scoped re-read: if the ownership-scoped UPDATE above matched nothing,
    // an unscoped read here would return (and leak) another user's project.
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json({ success: true, data: project });
  } catch (err) {
    res.status(500).json({ error: "Failed to update project" });
  }
});

router.put("/:id/projects", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const projectId = String(req.params["id"] ?? "");
    const body = req.body as { instruction?: string };

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const prompt = [
      "Regenerate this resume project with the same overall theme but fresh details.",
      body.instruction ? `Instruction: ${body.instruction}` : "",
      `Current project:\n${JSON.stringify(project.content)}`,
      PROJECT_SCHEMA_DESCRIPTION,
      "Respond with ONLY the single revised project JSON object, no other text.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const revised = await chatCompleteJSONWithBudgets<Record<string, unknown>>(
      prompt,
      PROJECT_REGEN_TOKEN_BUDGETS,
    );

    const newVersion = project.version + 1;
    const header = revised["projectHeader"] as { title?: string } | undefined;
    const intro = revised["introduction"] as { summary?: string } | undefined;

    await db
      .update(projectsTable)
      .set({
        title: header?.title || project.title,
        description: intro?.summary || project.description,
        content: revised,
        version: newVersion,
        updatedAt: new Date(),
      })
      .where(eq(projectsTable.id, projectId));

    await db.insert(projectVersionsTable).values({
      id: uuidv4(),
      projectId,
      version: newVersion,
      content: revised,
    });

    res.json({ success: true, data: revised });
  } catch (err) {
    console.error("[projects] replace error", err);
    res.status(500).json({ error: "Failed to replace project" });
  }
});

router.get("/:id/versions", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const projectId = String(req.params["id"] ?? "");

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const versions = await db
      .select()
      .from(projectVersionsTable)
      .where(eq(projectVersionsTable.projectId, projectId))
      .orderBy(desc(projectVersionsTable.version));

    res.json({ success: true, data: versions });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch versions" });
  }
});

router.post("/:id/versions/:versionId/rollback", requireAuth, async (req, res) => {
  res.status(501).json({ error: "Version rollback not implemented" });
});

router.post("/:id/edit-component", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const projectId = String(req.params["id"] ?? "");
    const body = req.body as { component?: string; instruction?: string };

    if (!body.component || !body.instruction) {
      res.status(400).json({ error: "component and instruction are required" });
      return;
    }

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const content = (project.content as Record<string, unknown>) ?? {};
    const currentValue = content[body.component];

    const prompt = [
      `Revise this part of a resume project ("${body.component}") per the instruction below.`,
      `Instruction: ${body.instruction}`,
      `Current value:\n${JSON.stringify(currentValue ?? "")}`,
      "Respond with ONLY the revised JSON value for this field (same shape as the input), no other text.",
    ].join("\n\n");

    const charged = await withCharge(
      res,
      {
        userId,
        operation: "project_edit_component",
        idempotencyKey: req.header("Idempotency-Key") ?? null,
      },
      async () =>
        chatCompleteJSON<unknown>({
          messages: [{ role: "user", content: prompt }],
          maxTokens: 2000,
        }),
    );
    if (!charged) return;
    const { result: revisedValue, meter: _meter } = charged;

    const updatedContent = { ...content, [body.component]: revisedValue };
    const newVersion = project.version + 1;

    await db
      .update(projectsTable)
      .set({ content: updatedContent, version: newVersion, updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));

    await db.insert(projectVersionsTable).values({
      id: uuidv4(),
      projectId,
      version: newVersion,
      content: updatedContent,
    });

    res.json({ success: true, data: { content: updatedContent, ..._meter } });
  } catch (err) {
    console.error("[projects] edit-component error", err);
    res.status(500).json({ error: "Failed to edit component" });
  }
});

/**
 * Project → PDF export. NOTE: the client (AIProjectsTable, Project
 * Recommendations) calls this as a plain GET with an Authorization header —
 * the previous stub was registered as POST, so the button 404'd before even
 * reaching the old 501. Registered as GET to match the real callers.
 */
router.get("/:id/export-pdf", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const projectId = String(req.params["id"] ?? "");
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const esc = (v: unknown) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const sections: string[] = [];
    if (project.description) {
      sections.push(`<h2>Overview</h2><p>${esc(project.description)}</p>`);
    }
    const content = project.content as Record<string, unknown> | null;
    if (content && typeof content === "object") {
      for (const [key, value] of Object.entries(content)) {
        if (key.startsWith("_") || value == null) continue;
        const heading = esc(key.replace(/([a-z])([A-Z])/g, "$1 $2")).replace(/^./, (c) =>
          c.toUpperCase(),
        );
        const bodyText = Array.isArray(value)
          ? `<ul>${value.map((v) => `<li>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</li>`).join("")}</ul>`
          : `<p>${esc(typeof value === "object" ? JSON.stringify(value, null, 2) : value)}</p>`;
        sections.push(`<h2>${heading}</h2>${bodyText}`);
      }
    }

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;margin:48px;line-height:1.5}
      h1{font-size:22px;margin:0 0 2px} .sub{color:#555;font-size:13px;margin:0 0 20px}
      h2{font-size:15px;border-bottom:1px solid #ccc;padding-bottom:3px;margin:18px 0 8px}
      p,li{font-size:12.5px} ul{margin:4px 0;padding-left:18px}
    </style></head><body>
      <h1>${esc(project.title)}</h1>
      <p class="sub">${esc(project.roleType ?? "")}</p>
      ${sections.join("\n")}
    </body></html>`;

    const pdf = await renderHtmlToPdf(html);
    const safeName = project.title.replace(/[^A-Za-z0-9 _.-]/g, "").slice(0, 120).trim() || "project";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.end(pdf);
  } catch (err) {
    if (err instanceof PdfError) {
      const status = err.code === "PDF_NOT_CONFIGURED" ? 501 : 500;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("[projects] export-pdf error", err);
    res.status(500).json({ error: "PDF export failed", code: "TEMPLATE_RENDER_ERROR" });
  }
});

export default router;
