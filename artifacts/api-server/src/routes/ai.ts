import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { chatCompleteJSON } from "../lib/openrouter.js";
import { getResumeContextById } from "../lib/resumeContext.js";
import { chargeOr402 } from "../lib/featureCredits.js";

const router: IRouter = Router();

router.post("/project-generation", requireAuth, async (req, res) => {
  try {
    const body = req.body as { resumeId?: string; sector?: string; roleType?: string };
    const resumeContext = await getResumeContextById(body.resumeId);

    const prompt = [
      "Suggest 3 resume-worthy project ideas for this candidate.",
      body.sector ? `Sector: ${body.sector}` : "",
      body.roleType ? `Role type: ${body.roleType}` : "",
      resumeContext ? `Candidate's resume:\n${resumeContext}` : "",
      'Respond with ONLY a JSON array of objects like { "title": string, "description": string }, no other text.',
    ]
      .filter(Boolean)
      .join("\n\n");

    const ideas = await chatCompleteJSON<{ title: string; description: string }[]>({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1500,
    });

    // Not currently wired to any UI (see endpoints.ts aiProjectGeneration) —
    // registered at 0 so it can't silently go unmetered the moment a future
    // UI wires it up (same treatment as projects/:id/edit-component).
    const _meter = await chargeOr402(res, {
      userId: req.userId!,
      operation: "ai_project_generation",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
    });
    if (!_meter) return;

    res.json({ success: true, data: { ideas, ..._meter } });
  } catch (err) {
    console.error("[ai] project-generation error", err);
    res.status(500).json({ error: "Failed to generate project ideas" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  const roleType = req.query["role_type"] as string | undefined;
  const categories = [
    { id: "web", name: "Web Development", roleType: "engineer" },
    { id: "mobile", name: "Mobile Development", roleType: "engineer" },
    { id: "data", name: "Data Science", roleType: "data" },
    { id: "ml", name: "Machine Learning", roleType: "data" },
    { id: "devops", name: "DevOps", roleType: "engineer" },
    { id: "design", name: "Product Design", roleType: "designer" },
  ];
  const filtered = roleType
    ? categories.filter((c) => c.roleType === roleType)
    : categories;
  res.json({ data: filtered });
});

export default router;
