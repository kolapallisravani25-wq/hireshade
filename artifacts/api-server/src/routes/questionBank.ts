import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import { questionsTable, savedQuestionsTable } from "@workspace/db/schema";
import { eq, and, ilike, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const router: IRouter = Router();

router.get("/explore/companies", requireAuth, async (req, res) => {
  try {
    const results = await db
      .selectDistinct({ company: questionsTable.company })
      .from(questionsTable)
      .where(eq(questionsTable.visibility, "public"));

    const companies = results
      .filter((r) => r.company != null)
      .map((r) => ({ name: r.company!, slug: r.company!.toLowerCase().replace(/\s+/g, "-"), count: 0 }));

    res.json({ success: true, data: companies });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

router.get("/explore/roles", requireAuth, async (req, res) => {
  try {
    const results = await db
      .selectDistinct({ role: questionsTable.role })
      .from(questionsTable)
      .where(eq(questionsTable.visibility, "public"));

    const roles = results
      .filter((r) => r.role != null)
      .map((r) => ({ name: r.role!, slug: r.role!.toLowerCase().replace(/\s+/g, "-"), count: 0 }));

    res.json({ success: true, data: roles });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch roles" });
  }
});

router.get("/explore/technologies", requireAuth, async (req, res) => {
  res.json({ success: true, data: [] });
});

router.get("/companies/:companySlug", requireAuth, async (req, res) => {
  const slug = String(req.params["companySlug"] ?? "");
  const company = slug.replace(/-/g, " ");

  const questions = await db
    .select()
    .from(questionsTable)
    .where(and(eq(questionsTable.visibility, "public"), ilike(questionsTable.company, company)))
    .orderBy(desc(questionsTable.createdAt));

  res.json({ success: true, data: { name: company, questions } });
});

router.get("/questions", requireAuth, async (req, res) => {
  try {
    const page = parseInt((req.query["page"] as string) ?? "1", 10);
    const limit = parseInt((req.query["limit"] as string) ?? "20", 10);
    const search = (req.query["search"] as string | undefined);
    const company = (req.query["company"] as string | undefined);
    const role = (req.query["role"] as string | undefined);
    const difficulty = (req.query["difficulty"] as string | undefined);

    let query = db
      .select()
      .from(questionsTable)
      .where(eq(questionsTable.visibility, "public"))
      .$dynamic();

    const conditions = [eq(questionsTable.visibility, "public")];
    if (search) conditions.push(ilike(questionsTable.question, `%${search}%`));
    if (company) conditions.push(ilike(questionsTable.company!, `%${company}%`));
    if (role) conditions.push(ilike(questionsTable.role!, `%${role}%`));

    const questions = await db
      .select()
      .from(questionsTable)
      .where(and(...conditions))
      .orderBy(desc(questionsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    res.json({
      success: true,
      data: questions,
      pagination: { page, limit, total: questions.length, pages: 1 },
      analytics: { totalQuestions: questions.length },
    });
  } catch (err) {
    console.error("[questionBank] list error", err);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

router.get("/questions/:questionId", requireAuth, async (req, res) => {
  try {
    const questionId = String(req.params["questionId"] ?? "");
    const [question] = await db
      .select()
      .from(questionsTable)
      .where(eq(questionsTable.id, questionId))
      .limit(1);

    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }

    res.json({ success: true, data: question });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch question" });
  }
});

router.post("/questions/:questionId/save", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const questionId = String(req.params["questionId"] ?? "");

    const existing = await db
      .select()
      .from(savedQuestionsTable)
      .where(
        and(
          eq(savedQuestionsTable.userId, userId),
          eq(savedQuestionsTable.questionId, questionId),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(savedQuestionsTable).values({
        id: uuidv4(),
        userId,
        questionId,
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save question" });
  }
});

router.delete("/questions/:questionId/save", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const questionId = String(req.params["questionId"] ?? "");

    await db
      .delete(savedQuestionsTable)
      .where(
        and(
          eq(savedQuestionsTable.userId, userId),
          eq(savedQuestionsTable.questionId, questionId),
        ),
      );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to unsave question" });
  }
});

router.get("/my/questions", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const page = parseInt((req.query["page"] as string) ?? "1", 10);
    const limit = parseInt((req.query["limit"] as string) ?? "20", 10);

    const saved = await db
      .select({ question: questionsTable })
      .from(savedQuestionsTable)
      .innerJoin(questionsTable, eq(savedQuestionsTable.questionId, questionsTable.id))
      .where(eq(savedQuestionsTable.userId, userId))
      .orderBy(desc(savedQuestionsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    res.json({
      success: true,
      data: saved.map((s) => ({
        ...s.question,
        contributionEnabled: s.question.contributionEnabled,
      })),
      pagination: { page, limit, total: saved.length, pages: 1 },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch saved questions" });
  }
});

export default router;
