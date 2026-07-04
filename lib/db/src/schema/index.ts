import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const sessionStatusEnum = pgEnum("session_status", [
  "PRE_CHECK",
  "ACTIVE",
  "COMPLETING",
  "COMPLETED",
  "CREDIT_EXHAUSTED",
  "FORCE_ENDED",
  "ABANDONED",
  "AUTO_ENDED",
]);

export const sessionModeEnum = pgEnum("session_mode", ["url", "manual"]);

export const resumeSourceEnum = pgEnum("resume_source", [
  "uploaded",
  "builder",
]);

export const questionDifficultyEnum = pgEnum("question_difficulty", [
  "easy",
  "medium",
  "hard",
]);

export const purchaseStatusEnum = pgEnum("purchase_status", [
  "pending",
  "completed",
  "failed",
  "refunded",
]);

// ── Users ─────────────────────────────────────────────────────────────────────

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// ── Sessions ──────────────────────────────────────────────────────────────────

export const sessionsTable = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    companyName: text("company_name").notNull().default(""),
    round: text("round"),
    jobDescription: text("job_description").notNull().default(""),
    mode: sessionModeEnum("mode").notNull().default("manual"),
    free: boolean("free").notNull().default(false),
    status: sessionStatusEnum("status").notNull().default("PRE_CHECK"),
    language: text("language").notNull().default("English"),
    simpleLanguage: boolean("simple_language").notNull().default(false),
    extraContext: text("extra_context").default(""),
    instructions: text("instructions").default(""),
    aiModel: text("ai_model").default("anthropic/claude-haiku-4-5"),
    autoGenerateResponse: boolean("auto_generate_response").notNull().default(true),
    saveTranscription: boolean("save_transcription").notNull().default(true),
    questionBankContributionOptIn: boolean("question_bank_contribution_opt_in")
      .notNull()
      .default(false),
    resumeId: text("resume_id"),
    documentId: text("document_id"),
    projectIds: jsonb("project_ids").$type<string[]>().default([]),
    primaryProjectId: text("primary_project_id"),
    creditsDeducted: numeric("credits_deducted"),
    deductionReason: text("deduction_reason"),
    aiUsage: integer("ai_usage").default(0),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    // DB-level single-live-session invariant. Application-level checks
    // (findBlockingSession + conditional UPDATE) are check-then-act: under
    // READ COMMITTED two concurrent activations of two DIFFERENT sessions
    // cannot see each other's uncommitted ACTIVE row, so both could win.
    // This partial unique index makes the second COMMIT fail (23505), which
    // the activate route converts into the standard 409 conflict.
    // DEPLOY NOTE: before `drizzle-kit push`, reap any legacy duplicates or
    // index creation fails:
    //   UPDATE sessions SET status='ABANDONED', ended_at=now()
    //   WHERE status IN ('ACTIVE','COMPLETING')
    //     AND id NOT IN (SELECT DISTINCT ON (user_id) id FROM sessions
    //                    WHERE status IN ('ACTIVE','COMPLETING')
    //                    ORDER BY user_id, updated_at DESC);
    uniqueIndex("sessions_one_live_per_user_idx")
      .on(t.userId)
      .where(sql`status IN ('ACTIVE', 'COMPLETING')`),
  ],
);

export const insertSessionSchema = createInsertSchema(sessionsTable);
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type DbSession = typeof sessionsTable.$inferSelect;

// ── Session Messages (Transcript) ─────────────────────────────────────────────

export const sessionMessagesTable = pgTable(
  "session_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    question: text("question"),
    answer: text("answer"),
    currentVersion: integer("current_version").notNull().default(1),
    aiModel: text("ai_model"),
    source: text("source").default("ai"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("session_messages_session_id_idx").on(t.sessionId)],
);

export const insertSessionMessageSchema = createInsertSchema(sessionMessagesTable);
export type InsertSessionMessage = z.infer<typeof insertSessionMessageSchema>;
export type SessionMessage = typeof sessionMessagesTable.$inferSelect;

// ── Answer Revisions ──────────────────────────────────────────────────────────

export const answerRevisionsTable = pgTable(
  "answer_revisions",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => sessionMessagesTable.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    version: integer("version").notNull(),
    question: text("question").notNull().default(""),
    answer: text("answer").notNull().default(""),
    source: text("source").notNull().default("ai"),
    aiMode: text("ai_mode"),
    instruction: text("instruction"),
    model: text("model"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("answer_revisions_message_id_idx").on(t.messageId)],
);

export type AnswerRevision = typeof answerRevisionsTable.$inferSelect;

// ── Documents ─────────────────────────────────────────────────────────────────

export const documentsTable = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    path: text("path").notNull().default(""),
    size: integer("size"),
    mimeType: text("mime_type"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("documents_user_id_idx").on(t.userId)],
);

export const insertDocumentSchema = createInsertSchema(documentsTable);
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type DbDocument = typeof documentsTable.$inferSelect;

// ── Resumes ───────────────────────────────────────────────────────────────────

export const resumesTable = pgTable(
  "resumes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    path: text("path").notNull().default(""),
    size: integer("size"),
    resumeContext: text("resume_context"),
    source: resumeSourceEnum("source").notNull().default("uploaded"),
    ats: boolean("ats").notNull().default(false),
    score: integer("score"),
    title: text("title"),
    templateId: text("template_id"),
    status: text("status").notNull().default("draft"),
    fields: jsonb("fields").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("resumes_user_id_idx").on(t.userId)],
);

export const insertResumeSchema = createInsertSchema(resumesTable);
export type InsertResume = z.infer<typeof insertResumeSchema>;
export type DbResume = typeof resumesTable.$inferSelect;

// ── Credits Balance ───────────────────────────────────────────────────────────

export const creditsBalanceTable = pgTable("credits_balance", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  purchasedCredits: numeric("purchased_credits").notNull().default("0"),
  earnedCredits: numeric("earned_credits").notNull().default("100"),
  heldCredits: numeric("held_credits").notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CreditsBalance = typeof creditsBalanceTable.$inferSelect;

// ── Credits Usage ─────────────────────────────────────────────────────────────

export const creditsUsageTable = pgTable(
  "credits_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    creditsUsed: numeric("credits_used").notNull(),
    cached: boolean("cached").notNull().default(false),
    // Client-supplied per-action key (creditedAi.createIdempotencyKey). A
    // unique index makes replays (double-click / retry) a no-op: the second
    // insert conflicts and the original charge result is returned instead of
    // charging again.
    idempotencyKey: text("idempotency_key"),
    resumeId: text("resume_id"),
    sessionId: text("session_id"),
    aiModel: text("ai_model"),
    aiCostUsd: numeric("ai_cost_usd"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("credits_usage_user_id_idx").on(t.userId),
    uniqueIndex("credits_usage_idempotency_key_idx").on(t.idempotencyKey),
  ],
);

export type CreditsUsage = typeof creditsUsageTable.$inferSelect;

// ── Credits Purchases ─────────────────────────────────────────────────────────

export const creditsPurchasesTable = pgTable(
  "credits_purchases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    orderId: text("order_id"),
    paymentId: text("payment_id"),
    amount: numeric("amount"),
    currency: text("currency").default("INR"),
    creditsPurchased: numeric("credits_purchased"),
    status: purchaseStatusEnum("status").notNull().default("pending"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("credits_purchases_user_id_idx").on(t.userId)],
);

export type CreditsPurchase = typeof creditsPurchasesTable.$inferSelect;

// ── Question Bank ─────────────────────────────────────────────────────────────

export const questionsTable = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    question: text("question").notNull(),
    title: text("title").notNull().default(""),
    company: text("company"),
    role: text("role"),
    technologies: jsonb("technologies").$type<string[]>().default([]),
    topics: jsonb("topics").$type<string[]>().default([]),
    difficulty: questionDifficultyEnum("difficulty").notNull().default("medium"),
    contributorUserId: text("contributor_user_id"),
    contributionEnabled: boolean("contribution_enabled").notNull().default(false),
    visibility: text("visibility").notNull().default("public"),
    sessionId: text("session_id"),
    upvotes: integer("upvotes").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("questions_company_idx").on(t.company)],
);

export type Question = typeof questionsTable.$inferSelect;

// ── Saved Questions ───────────────────────────────────────────────────────────

export const savedQuestionsTable = pgTable(
  "saved_questions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questionsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("saved_questions_user_id_idx").on(t.userId)],
);

// ── AI Projects ───────────────────────────────────────────────────────────────

export const projectsTable = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    roleType: text("role_type"),
    content: jsonb("content"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("projects_user_id_idx").on(t.userId)],
);

export type Project = typeof projectsTable.$inferSelect;

// ── Project Versions ──────────────────────────────────────────────────────────

export const projectVersionsTable = pgTable(
  "project_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: jsonb("content"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("project_versions_project_id_idx").on(t.projectId)],
);

// ── AI Assistant ────────────────────────────────────────────────────────────

export const assistantChatsTable = pgTable(
  "assistant_chats",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New Chat"),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("assistant_chats_user_id_idx").on(t.userId)],
);

export type AssistantChat = typeof assistantChatsTable.$inferSelect;

export const assistantMessagesTable = pgTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => assistantChatsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "USER" | "ASSISTANT"
    content: text("content").notNull().default(""),
    citations: jsonb("citations").$type<
      { id: string; question: string; sessionId?: string; companyName?: string | null }[]
    >(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("assistant_messages_chat_id_idx").on(t.chatId)],
);

export type AssistantMessage = typeof assistantMessagesTable.$inferSelect;

/**
 * Session feedback / Insights (spec §4.3, §7 session_insights, §8, §13).
 * One row per session — the AI-generated post-session evaluation surfaced in
 * the review page's Insights/Analytics tab. Generated once (idempotent),
 * persisted, and re-served on subsequent opens. Numeric metrics are 0–100.
 */
export const sessionFeedbackTable = pgTable(
  "session_feedback",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Core 0–100 metrics the review dialog renders.
    score: integer("score").notNull().default(0),
    confidence: integer("confidence").notNull().default(0),
    communication: integer("communication").notNull().default(0),
    interactivity: integer("interactivity").notNull().default(0),
    technicalDepth: integer("technical_depth").notNull().default(0),
    conciseness: integer("conciseness").notNull().default(0),
    avgResponseTime: integer("avg_response_time"), // seconds, nullable
    interviewerMood: text("interviewer_mood"),
    summary: text("summary"),
    strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
    improvements: jsonb("improvements").$type<string[]>().notNull().default([]),
    // Spec §7 session_insights fields.
    keyTopics: jsonb("key_topics").$type<string[]>().notNull().default([]),
    studyAreas: jsonb("study_areas").$type<string[]>().notNull().default([]),
    resumeGaps: jsonb("resume_gaps").$type<string[]>().notNull().default([]),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("session_feedback_session_id_idx").on(t.sessionId)],
);

export type SessionFeedback = typeof sessionFeedbackTable.$inferSelect;
