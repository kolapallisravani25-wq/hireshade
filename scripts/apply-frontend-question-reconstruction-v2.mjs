import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "artifacts/craft-vita/src/pages/Sessions/ActiveSession/page.tsx");
let s = fs.readFileSync(file, "utf8");
const before = s;

// If v1 patch is already present, make it use a wider window.
s = s.replace("const recentWindowMs = 120_000;", "const recentWindowMs = 180_000;");

// The stabilizer can emit only the final clause. Use pendingTranscriptRef as the raw source.
s = s.replace(
  "const fullQuestionForGeneration = buildFullQuestionForGeneration(messagesRef.current, stableTranscript);",
  "const rawBufferedTranscript = pendingTranscriptRef.current.join(\" \" ).trim();\n    const reconstructionSource = rawBufferedTranscript || stableTranscript;\n    const fullQuestionForGeneration = buildFullQuestionForGeneration(messagesRef.current, reconstructionSource);",
);

// If v1 was not applied, inject a minimal helper set.
if (!s.includes("function buildFullQuestionForGeneration(")) {
  const anchor = "function buildOverlayTranscript(messages: Message[]): string {";
  const idx = s.indexOf(anchor);
  if (idx < 0) throw new Error("Cannot locate buildOverlayTranscript");
  const end = s.indexOf("\n}\n", idx) + 3;
  const helper = `

const QUESTION_START_RE = /\\b(can you|could you|would you|please|explain|describe|tell me|walk me|introduce yourself|what|why|how|when|where|which|who|write|implement|build|create|show|give)\\b/i;
const LONG_QUESTION_RE = /\\b(introduce yourself|walk me through|business problem|architecture|data flow|responsibilities|challenges|outcomes|optimizations|technology stack)\\b/i;

function normalizeForQuestionJoin(text: string): string {
  return normalizeSttTranscript(text || "").replace(/\\s+/g, " ").trim();
}

function buildFullQuestionForGeneration(messages: Message[], stableOrFallback: string): string {
  const now = Date.now();
  const stable = normalizeForQuestionJoin(stableOrFallback);
  const chunks = messages
    .filter((m) => m.sender === "Interviewer" && m.text?.trim())
    .filter((m) => !m.timestamp || now - m.timestamp <= 180_000)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .map((m) => normalizeForQuestionJoin(m.text))
    .filter(Boolean);
  if (stable && !chunks.some((chunk) => areNearDuplicateTexts(chunk, stable))) chunks.push(stable);
  if (!chunks.length) return stable;
  let startIndex = -1;
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    if (QUESTION_START_RE.test(chunks[i])) { startIndex = i; break; }
  }
  const full = (startIndex >= 0 ? chunks.slice(startIndex) : chunks).join(" ").replace(/\\s+/g, " ").trim();
  return full.length > stable.length ? full : stable || full;
}

function shouldKeepAsSingleQuestion(question: string): boolean {
  const q = normalizeForQuestionJoin(question);
  return q.split(/\\s+/).length >= 22 || LONG_QUESTION_RE.test(q);
}
`;
  s = s.slice(0, end) + helper + s.slice(end);
}

// If auto path still has the original segmenter, replace it.
s = s.replace(
`    const segmentedQuestions = segmentQuestions(stableTranscript);
    const segmentsToGenerate =
      segmentedQuestions.length >= 2
        ? segmentedQuestions
        : classification.shouldGroup
          ? [stableTranscript]
          : classification.segments;`,
`    const rawBufferedTranscript = pendingTranscriptRef.current.join(" " ).trim();
    const reconstructionSource = rawBufferedTranscript || stableTranscript;
    const fullQuestionForGeneration = buildFullQuestionForGeneration(messagesRef.current, reconstructionSource);
    const forceSingleQuestion = shouldKeepAsSingleQuestion(fullQuestionForGeneration);
    const segmentedQuestions = forceSingleQuestion ? [] : segmentQuestions(fullQuestionForGeneration);
    const segmentsToGenerate = forceSingleQuestion
      ? [fullQuestionForGeneration]
      : segmentedQuestions.length >= 2
        ? segmentedQuestions
        : [fullQuestionForGeneration];
    console.log("[AutoAnswer] full question", {
      rawBufferedTranscript: rawBufferedTranscript.slice(0, 240),
      stableTranscript: stableTranscript.slice(0, 160),
      fullQuestion: fullQuestionForGeneration.slice(0, 320),
      forceSingleQuestion,
    });`,
);

s = s.replace(
  "transcript: stableTranscript,\n          currentQuestion: adaptiveCtx.currentQuestion || stableTranscript,",
  "transcript: fullQuestionForGeneration,\n          currentQuestion: fullQuestionForGeneration,",
);
s = s.replace(
  "transcript: segment,\n              currentQuestion: segment,",
  "transcript: fullQuestionForGeneration,\n              currentQuestion: segment,",
);

// Manual click path: force reconstructed question to win over adaptive tail fragments.
s = s.replace(
  "const bestCurrentQuestion = adaptiveContext.currentQuestion || question;",
  "const bestCurrentQuestion = question || adaptiveContext.currentQuestion;",
);

if (s !== before) {
  fs.writeFileSync(file, s);
  console.log("Patched frontend question reconstruction v2");
} else {
  console.log("No changes needed");
}
