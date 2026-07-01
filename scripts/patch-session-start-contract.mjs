import fs from "node:fs";

const file = "artifacts/api-server/src/routes/sessions.ts";
let s = fs.readFileSync(file, "utf8");

function replaceIfPresent(find, replace) {
  if (s.includes(find)) {
    s = s.replace(find, replace);
  }
}

replaceIfPresent(
  'import { eq, and, desc, ilike, gte, lte } from "drizzle-orm";',
  'import { eq, and, desc, ilike, gte, lte, inArray, ne } from "drizzle-orm";',
);

replaceIfPresent('process.env["OPENROUTER_MAX_TOKENS"] ?? "400",', 'process.env["OPENROUTER_MAX_TOKENS"] ?? "1200",');
replaceIfPresent(': 400;\n\nconst formParser', ': 1200;\n\nconst formParser');

replaceIfPresent(
  'const screenshotParser = multer({\n  storage: multer.memoryStorage(),\n  limits: { fileSize: 10 * 1024 * 1024 },\n}).single("screenshot");',
  'const screenshotParser = multer({\n  storage: multer.memoryStorage(),\n  limits: { fileSize: 10 * 1024 * 1024 },\n}).single("screenshot");\n\nconst FREE_SESSION_MINUTES = 5;\nconst BLOCKING_STATUSES = ["ACTIVE", "COMPLETING"] as const;\n\nasync function findBlockingSession(userId: string, excludeId?: string) {\n  const conditions = [\n    eq(sessionsTable.userId, userId),\n    inArray(sessionsTable.status, [...BLOCKING_STATUSES]),\n  ];\n  if (excludeId) conditions.push(ne(sessionsTable.id, excludeId));\n  const [blocking] = await db.select().from(sessionsTable).where(and(...conditions)).limit(1);\n  return blocking;\n}\n\nfunction maxAllowedMinutesFor(s: typeof sessionsTable.$inferSelect) {\n  return s.free ? FREE_SESSION_MINUTES : null;\n}',
);

replaceIfPresent(
  '    aiUsage: s.aiUsage,\n    endedAt: s.endedAt,',
  '    aiUsage: s.aiUsage,\n    startedAt: (s as any).startedAt,\n    endedAt: s.endedAt,\n    maxAllowedMinutes: maxAllowedMinutesFor(s),',
);

replaceIfPresent(
  '    startedAt: s.startedAt,',
  '    startedAt: (s as any).startedAt,',
);

replaceIfPresent(
  'const aiModel = body["aiModel"] ?? "anthropic/claude-haiku-4-5";',
  'const aiModel = process.env["ANSWER_MODEL"] || "google/gemini-2.5-flash-lite";',
);

replaceIfPresent(
  '    const sessionId = uuidv4();\n    const now = new Date();',
  '    const blocking = await findBlockingSession(userId);\n    if (blocking) {\n      res.status(409).json({ error: "ACTIVE_SESSION_EXISTS:" + blocking.id });\n      return;\n    }\n\n    const sessionId = uuidv4();\n    const now = new Date();',
);

const oldActivate = '    await db\n      .update(sessionsTable)\n      .set({ status: "ACTIVE", updatedAt: new Date() })\n      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)));\n\n    res.json({ success: true, status: "ACTIVE" });';
const newActivate = '    const [session] = await db\n      .select()\n      .from(sessionsTable)\n      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))\n      .limit(1);\n\n    if (!session) {\n      res.status(404).json({ error: "Session not found" });\n      return;\n    }\n\n    const blocking = await findBlockingSession(userId, sessionId);\n    if (blocking) {\n      res.status(409).json({ error: "ACTIVE_SESSION_EXISTS:" + blocking.id });\n      return;\n    }\n\n    const startedAt = (session as any).startedAt ?? new Date();\n\n    await db\n      .update(sessionsTable)\n      .set({ status: "ACTIVE", startedAt, updatedAt: new Date() } as any)\n      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)));\n\n    res.json({ success: true, status: "ACTIVE", startedAt, maxAllowedMinutes: maxAllowedMinutesFor(session) });';
replaceIfPresent(oldActivate, newActivate);

replaceIfPresent(
  'const startedAt = session.startedAt ?? new Date();',
  'const startedAt = (session as any).startedAt ?? new Date();',
);
replaceIfPresent(
  '.set({ status: "ACTIVE", startedAt, updatedAt: new Date() })',
  '.set({ status: "ACTIVE", startedAt, updatedAt: new Date() } as any)',
);
replaceIfPresent(
  'const aiModel = (req.body?.["aiModel"] as string) || session.aiModel || undefined;',
  'const aiModel = session.aiModel || process.env["ANSWER_MODEL"] || undefined;',
);
replaceIfPresent(
  'const aiModel = body.aiModel || session.aiModel || undefined;',
  'const aiModel = session.aiModel || process.env["ANSWER_MODEL"] || undefined;',
);
replaceIfPresent(
  'model: body.model || session.aiModel,',
  'model: session.aiModel || process.env["ANSWER_MODEL"],',
);

fs.writeFileSync(file, s);
console.log("Patched session start contract");
