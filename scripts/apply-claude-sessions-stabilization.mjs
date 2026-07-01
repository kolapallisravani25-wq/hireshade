import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);
const changed = [];

function save(p, before, after) {
  if (before !== after) {
    write(p, after);
    changed.push(p);
  }
}

// 1) DB schema: add sessions.startedAt if missing.
{
  const p = "lib/db/src/schema/index.ts";
  let s = read(p);
  const before = s;
  if (!s.includes('startedAt: timestamp("started_at")')) {
    s = s.replace(
      '    aiUsage: integer("ai_usage").default(0),\n    endedAt: timestamp("ended_at"),',
      '    aiUsage: integer("ai_usage").default(0),\n    startedAt: timestamp("started_at"),\n    endedAt: timestamp("ended_at"),',
    );
  }
  save(p, before, s);
}

// 2) Sessions route: timer anchor, conflict contract, single-active guard.
{
  const p = "artifacts/api-server/src/routes/sessions.ts";
  let s = read(p);
  const before = s;

  s = s.replace(
    'import { eq, and, desc, ilike, gte, lte } from "drizzle-orm";',
    'import { eq, and, desc, ilike, gte, lte, inArray, ne } from "drizzle-orm";',
  );

  if (!s.includes("const FREE_SESSION_MINUTES = 5;")) {
    s = s.replace(
      '}).single("screenshot");',
      `}).single("screenshot");

/** Free-session cap in minutes. Mirrors the client countdown. */
const FREE_SESSION_MINUTES = 5;
const BLOCKING_STATUSES = ["ACTIVE", "COMPLETING"] as const;

async function findBlockingSession(userId: string, excludeId?: string) {
  const conditions = [
    eq(sessionsTable.userId, userId),
    inArray(sessionsTable.status, [...BLOCKING_STATUSES]),
  ];
  if (excludeId) conditions.push(ne(sessionsTable.id, excludeId));
  const [blocking] = await db.select().from(sessionsTable).where(and(...conditions)).limit(1);
  return blocking;
}

function maxAllowedMinutesFor(session: typeof sessionsTable.$inferSelect) {
  return session.free ? FREE_SESSION_MINUTES : null;
}

function activeSessionConflict(id: string) {
  const token = \`ACTIVE_SESSION_EXISTS:\${id}\`;
  return { error: token, message: token };
}`,
    );
  }

  if (!s.includes("startedAt: (s as any).startedAt,")) {
    s = s.replace(
      '    aiUsage: s.aiUsage,\n    endedAt: s.endedAt,',
      '    aiUsage: s.aiUsage,\n    startedAt: (s as any).startedAt,\n    endedAt: s.endedAt,\n    maxAllowedMinutes: maxAllowedMinutesFor(s),',
    );
    s = s.replace("startedAt: s.startedAt,", "startedAt: (s as any).startedAt,");
  }

  if (!s.includes("await findBlockingSession(userId);")) {
    s = s.replace(
      '    const primaryProjectId = body["primaryProjectId"] || null;\n\n    const sessionId = uuidv4();',
      '    const primaryProjectId = body["primaryProjectId"] || null;\n\n    const blocking = await findBlockingSession(userId);\n    if (blocking) {\n      res.status(409).json(activeSessionConflict(blocking.id));\n      return;\n    }\n\n    const sessionId = uuidv4();',
    );
  }

  // Normalize direct conflict responses to dual field shape if older patch was partially applied.
  s = s.replace(
    /res\.status\(409\)\.json\(\{ error: `ACTIVE_SESSION_EXISTS:\$\{blocking\.id\}` \}\);/g,
    'res.status(409).json(activeSessionConflict(blocking.id));',
  );

  const activateRegex = /router\.post\("\/:id\/activate", requireAuth, async \(req, res\) => \{[\s\S]*?\n\}\);\n\nrouter\.post\("\/:id\/heartbeat"/;
  const activateReplacement = `router.post("/:id/activate", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const blocking = await findBlockingSession(userId, sessionId);
    if (blocking) {
      res.status(409).json(activeSessionConflict(blocking.id));
      return;
    }

    const startedAt = (session as any).startedAt ?? new Date();

    await db
      .update(sessionsTable)
      .set({ status: "ACTIVE", startedAt, updatedAt: new Date() } as any)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)));

    res.json({
      success: true,
      status: "ACTIVE",
      startedAt,
      maxAllowedMinutes: maxAllowedMinutesFor(session),
    });
  } catch (err) {
    console.error("[sessions] activate error", err);
    res.status(500).json({ error: "Failed to activate session" });
  }
});

router.post("/:id/heartbeat"`;
  if (activateRegex.test(s)) s = s.replace(activateRegex, activateReplacement);

  // Typecheck-safe compatibility casts for workspaces whose generated DB type cache
  // has not picked up startedAt even after the source schema has been updated.
  s = s.replace("startedAt: s.startedAt,", "startedAt: (s as any).startedAt,");
  s = s.replace("const startedAt = session.startedAt ?? new Date();", "const startedAt = (session as any).startedAt ?? new Date();");
  s = s.replace('.set({ status: "ACTIVE", startedAt, updatedAt: new Date() })', '.set({ status: "ACTIVE", startedAt, updatedAt: new Date() } as any)');

  save(p, before, s);
}

// 3) OpenRouter: add bounded timeout protection without changing the existing default model.
{
  const p = "artifacts/api-server/src/lib/openrouter.ts";
  let s = read(p);
  const before = s;

  if (!s.includes("OPENROUTER_TIMEOUT_MS")) {
    s = s.replace(
      /const DEFAULT_MODEL = .*?;\n/,
      (m) => `${m}
const OPENROUTER_TIMEOUT_MS = Number(process.env["OPENROUTER_TIMEOUT_MS"] ?? "60000") || 60000;
const OPENROUTER_STREAM_IDLE_MS = Number(process.env["OPENROUTER_STREAM_IDLE_MS"] ?? "45000") || 45000;
`,
    );
  }

  if (!s.includes("signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS)")) {
    s = s.replace(
      /body: JSON\.stringify\(\{\n\s*model: resolveModel\(opts\.model\),\n\s*messages: opts\.messages,\n\s*temperature: opts\.temperature \?\? 0\.5,\n\s*max_tokens: opts\.maxTokens \?\? \d+,\n\s*\}\),\n\s*\}\);/,
      (m) => m.replace("\n  });", "\n    signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),\n  });"),
    );
  }

  if (!s.includes("const controller = new AbortController();")) {
    const streamRegex = /export async function streamChatComplete\([\s\S]*?\n\}\n?$/;
    const streamReplacement = `export async function streamChatComplete(
  opts: {
    model?: string | null;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
  },
  onDelta: (chunk: string) => void,
): Promise<string> {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), OPENROUTER_STREAM_IDLE_MS);
  };

  try {
    armIdle();
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: \`Bearer \${getApiKey()}\`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolveModel(opts.model),
        messages: opts.messages,
        temperature: opts.temperature ?? 0.5,
        max_tokens: opts.maxTokens ?? 2000,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, text }, "[openrouter] streamChatComplete failed");
      throw new Error(\`OpenRouter request failed (\${res.status})\`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(delta);
          }
        } catch {
          // Ignore malformed/partial SSE lines.
        }
      }
    }

    return full;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}
`;
    if (streamRegex.test(s)) s = s.replace(streamRegex, streamReplacement);
  }

  save(p, before, s);
}

console.log(changed.length ? `Patched:\n${changed.join("\n")}` : "No changes needed; patch already applied.");
