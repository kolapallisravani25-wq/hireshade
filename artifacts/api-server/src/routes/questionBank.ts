import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import { questionsTable, savedQuestionsTable } from "@workspace/db/schema";
import { eq, and, or, ilike, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const router: IRouter = Router();

/**
 * The anonymised public shape of a question-bank row.
 *
 * `contributor_user_id` and `session_id` exist on the table but are internal
 * linkage — the product's privacy guarantee is that no consumer of the
 * Question Bank can ever see who contributed a question. Every read endpoint
 * in this router MUST use this projection (or a subset of it) instead of
 * `db.select()` / `SELECT *`, which would leak both ids to any authenticated
 * user in the JSON response.
 */
const anonymisedQuestionColumns = {
  id: questionsTable.id,
  question: questionsTable.question,
  title: questionsTable.title,
  company: questionsTable.company,
  role: questionsTable.role,
  technologies: questionsTable.technologies,
  topics: questionsTable.topics,
  difficulty: questionsTable.difficulty,
  visibility: questionsTable.visibility,
  upvotes: questionsTable.upvotes,
  createdAt: questionsTable.createdAt,
  updatedAt: questionsTable.updatedAt,
} as const;

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
    .select(anonymisedQuestionColumns)
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

    const conditions = [eq(questionsTable.visibility, "public")];
    if (search) conditions.push(ilike(questionsTable.question, `%${search}%`));
    if (company) conditions.push(ilike(questionsTable.company!, `%${company}%`));
    if (role) conditions.push(ilike(questionsTable.role!, `%${role}%`));
    // Validate against the enum before filtering — an arbitrary string would
    // throw a Postgres enum cast error and turn the whole request into a 500.
    if (difficulty === "easy" || difficulty === "medium" || difficulty === "hard") {
      conditions.push(eq(questionsTable.difficulty, difficulty));
    }

    const [questions, [countRow]] = await Promise.all([
      db
        .select(anonymisedQuestionColumns)
        .from(questionsTable)
        .where(and(...conditions))
        .orderBy(desc(questionsTable.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(questionsTable)
        .where(and(...conditions)),
    ]);

    const total = countRow?.count ?? questions.length;

    res.json({
      success: true,
      data: questions,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      analytics: { totalQuestions: total },
    });
  } catch (err) {
    console.error("[questionBank] list error", err);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

router.get("/questions/:questionId", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const questionId = String(req.params["questionId"] ?? "");
    // Visibility was previously not checked at all — any authenticated user
    // could read any question by id, public or not. A question is readable
    // if it is public, or if the requester is its contributor. The contributor
    // check happens in SQL; the contributor id itself is never returned.
    const [question] = await db
      .select(anonymisedQuestionColumns)
      .from(questionsTable)
      .where(
        and(
          eq(questionsTable.id, questionId),
          or(
            eq(questionsTable.visibility, "public"),
            eq(questionsTable.contributorUserId, userId),
          ),
        ),
      )
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

    // Only visible questions can be saved. Without this, saving an arbitrary
    // id and then reading /my/questions was a full bypass of the visibility
    // check — private question content readable by anyone who had the id.
    const [visible] = await db
      .select({ id: questionsTable.id })
      .from(questionsTable)
      .where(
        and(
          eq(questionsTable.id, questionId),
          or(
            eq(questionsTable.visibility, "public"),
            eq(questionsTable.contributorUserId, userId),
          ),
        ),
      )
      .limit(1);

    if (!visible) {
      res.status(404).json({ error: "Question not found" });
      return;
    }

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
      .select(anonymisedQuestionColumns)
      .from(savedQuestionsTable)
      .innerJoin(questionsTable, eq(savedQuestionsTable.questionId, questionsTable.id))
      .where(eq(savedQuestionsTable.userId, userId))
      .orderBy(desc(savedQuestionsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    res.json({
      success: true,
      data: saved,
      pagination: { page, limit, total: saved.length, pages: 1 },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch saved questions" });
  }
});

export default router;
