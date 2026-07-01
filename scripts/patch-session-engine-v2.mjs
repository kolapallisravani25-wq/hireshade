import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sessionsPath = path.join(root, "artifacts/api-server/src/routes/sessions.ts");

if (!fs.existsSync(sessionsPath)) {
  throw new Error(`sessions.ts not found at ${sessionsPath}. Run from repo root.`);
}

let src = fs.readFileSync(sessionsPath, "utf8");
const before = src;

function replaceOnce(find, replace, label) {
  if (!src.includes(find)) {
    throw new Error(`Patch anchor not found: ${label}`);
  }
  src = src.replace(find, replace);
}

replaceOnce(
  'process.env["OPENROUTER_MAX_TOKENS"] ?? "400",',
  'process.env["OPENROUTER_MAX_TOKENS"] ?? "1200",',
  "default OpenRouter token budget",
);

replaceOnce(
  ": 400;",
  ": 1200;",
  "fallback OpenRouter token budget",
);

replaceOnce(
  'const aiModel = body["aiModel"] ?? "anthropic/claude-haiku-4-5";',
  'const aiModel = process.env["ANSWER_MODEL"] || "google/gemini-2.5-flash-lite";',
  "server controlled session model at creation",
);

replaceOnce(
  'const aiModel = (req.body?.["aiModel"] as string) || session.aiModel || undefined;',
  'const aiModel = session.aiModel || process.env["ANSWER_MODEL"] || undefined;',
  "server controlled screenshot model",
);

replaceOnce(
  `const screenshotParser = multer({\n  storage: multer.memoryStorage(),\n  limits: { fileSize: 10 * 1024 * 1024 },\n}).single("screenshot");`,
  `const screenshotParser = multer({\n  storage: multer.memoryStorage(),\n  limits: { fileSize: 10 * 1024 * 1024 },\n}).single("screenshot");\n\nconst RECENT_TRANSCRIPT_MAX_CHARS = 6_000;\nconst CURRENT_QUESTION_MAX_CHARS = 1_200;\nconst RECENT_HISTORY_LIMIT = 8;\n\nfunction compactText(value: unknown, maxChars: number): string {\n  return String(value ?? "")\n    .replace(/\\s+/g, " ")\n    .trim()\n    .slice(0, maxChars);\n}\n\nfunction buildSessionAnswerUserPrompt(body: {\n  transcript?: string;\n  currentQuestion?: string;\n  patchedTranscript?: string;\n  regenerateInstruction?: string;\n  previousAiAnswer?: string;\n  answerMode?: string;\n  recentTranscriptWindow?: string[];\n  speakerSeparatedTranscript?: { speakerType?: string; content?: string; timestamp?: number }[];\n}): string {\n  const currentQuestion = compactText(\n    body.patchedTranscript || body.currentQuestion || body.transcript,\n    CURRENT_QUESTION_MAX_CHARS,\n  );\n  const recentWindow = Array.isArray(body.recentTranscriptWindow)\n    ? body.recentTranscriptWindow.slice(-10).map((x) => compactText(x, 600)).filter(Boolean)\n    : [];\n  const speakerWindow = Array.isArray(body.speakerSeparatedTranscript)\n    ? body.speakerSeparatedTranscript\n        .slice(-10)\n        .map((x) => `${x.speakerType || "speaker"}: ${compactText(x.content, 600)}`)\n        .filter((x) => x.trim().length > 9)\n    : [];\n  const transcript = compactText(body.transcript, RECENT_TRANSCRIPT_MAX_CHARS);\n\n  const sections = [\n    "Generate the user's best first-person answer for the current session prompt.",\n    "Detect the actual question from the transcript/context below; if a direct question is provided, prioritize it.",\n    "Return a polished answer with clear markdown formatting and no dummy fallback text.",\n  ];\n\n  if (body.regenerateInstruction) {\n    sections.push(`Regeneration instruction: ${compactText(body.regenerateInstruction, 800)}`);\n  }\n  if (body.previousAiAnswer) {\n    sections.push(`Previous answer to improve or continue from:\n${compactText(body.previousAiAnswer, 2_000)}`);\n  }\n  if (currentQuestion) {\n    sections.push(`=== CURRENT QUESTION OR PATCHED TRANSCRIPT ===\n${currentQuestion}`);\n  }\n  if (speakerWindow.length) {\n    sections.push(`=== SPEAKER-SEPARATED RECENT TRANSCRIPT ===\n${speakerWindow.join("\\n")}`);\n  }\n  if (recentWindow.length) {\n    sections.push(`=== RECENT TRANSCRIPT WINDOW ===\n${recentWindow.join("\\n")}`);\n  }\n  if (transcript && !currentQuestion.includes(transcript)) {\n    sections.push(`=== FULL BOUNDED TRANSCRIPT CONTEXT ===\n${transcript}`);\n  }\n\n  return sections.join("\\n\\n");\n}`,
  "session prompt helpers",
);

replaceOnce(
  `    const body = req.body as {\n      transcript?: string;\n      currentQuestion?: string;\n      patchedTranscript?: string;\n      previousAiAnswer?: string;\n      regenerateInstruction?: string;\n      answerMode?: string;\n      aiModel?: string;\n    };`,
  `    const body = req.body as {\n      transcript?: string;\n      currentQuestion?: string;\n      patchedTranscript?: string;\n      previousAiAnswer?: string;\n      regenerateInstruction?: string;\n      answerMode?: string;\n      aiModel?: string;\n      recentTranscriptWindow?: string[];\n      speakerSeparatedTranscript?: { speakerType?: string; content?: string; timestamp?: number }[];\n    };`,
  "ai-answer request body",
);

replaceOnce(
  `    const question =\n      body.patchedTranscript?.trim() ||\n      body.currentQuestion?.trim() ||\n      body.transcript?.trim() ||\n      "";`,
  `    const question = compactText(\n      body.patchedTranscript || body.currentQuestion || body.transcript,\n      CURRENT_QUESTION_MAX_CHARS,\n    );`,
  "bounded question selection",
);

replaceOnce(
  `    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];\n    if (body.previousAiAnswer) {\n      messages.push({ role: "assistant", content: body.previousAiAnswer });\n    }\n    if (body.regenerateInstruction) {\n      messages.push({\n        role: "user",\n        content: \`Revise the previous answer per this instruction: ${body.regenerateInstruction}\\n\\nOriginal question: ${question}\`,\n      });\n    } else {\n      messages.push({ role: "user", content: question });\n    }\n\n    const aiModel = body.aiModel || session.aiModel || undefined;`,
  `    const recentMessages = await db\n      .select()\n      .from(sessionMessagesTable)\n      .where(eq(sessionMessagesTable.sessionId, sessionId))\n      .orderBy(desc(sessionMessagesTable.createdAt))\n      .limit(RECENT_HISTORY_LIMIT);\n\n    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];\n    for (const message of recentMessages.reverse()) {\n      if (message.role === "assistant" && message.answer) {\n        messages.push({ role: "assistant", content: compactText(message.answer, 1_200) });\n      } else if (message.role !== "assistant" && message.content) {\n        messages.push({ role: "user", content: compactText(message.content, 800) });\n      }\n    }\n    messages.push({ role: "user", content: buildSessionAnswerUserPrompt(body) });\n\n    const aiModel = session.aiModel || process.env["ANSWER_MODEL"] || undefined;`,
  "session context and model selection",
);

if (src === before) {
  throw new Error("No changes applied.");
}

fs.writeFileSync(sessionsPath, src);
console.log("Session Engine v2 patch applied to", sessionsPath);
console.log("Next: pnpm --filter @workspace/api-server typecheck && pnpm --filter @workspace/api-server build");
