import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);
const changed = [];

function save(file, before, after) {
  if (before !== after) {
    write(file, after);
    changed.push(file);
  }
}

const file = "artifacts/craft-vita/src/pages/Sessions/ActiveSession/page.tsx";
let s = read(file);
const before = s;

if (!s.includes("function buildFullQuestionForGeneration(")) {
  const anchor = `function buildOverlayTranscript(messages: Message[]): string {
  const joined = messages
    .slice(-OVERLAY_TRANSCRIPT_MAX_MESSAGES)
    .map((m) => m.text)
    .join("\n")
    .trim();
  if (joined.length <= OVERLAY_TRANSCRIPT_MAX_CHARS) return joined;
  return joined.slice(joined.length - OVERLAY_TRANSCRIPT_MAX_CHARS);
}`;

  const helper = `${anchor}

const QUESTION_START_RE =
  /\b(can you|could you|would you|please|explain|describe|tell me|walk me|introduce yourself|what|why|how|when|where|which|who|write|implement|build|create|show|give)\b/i;
const TRAILING_FRAGMENT_RE =
  /\b(assume i'm the interviewer|assume i’m the interviewer|as you would in a real interview|key outcomes|performance optimizations|how you resolved|your responsibilities|technologies used|technology stack|data flow|challenges you faced)\b/i;

function normalizeForQuestionJoin(text: string): string {
  return normalizeSttTranscript(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyTailFragment(text: string): boolean {
  const t = normalizeForQuestionJoin(text).toLowerCase();
  if (!t) return true;
  if (t.length < 100 && TRAILING_FRAGMENT_RE.test(t)) return true;
  if (/^(and|or|then|also|plus|because|so|where|how|what)\b/i.test(t) && t.split(/\s+/).length < 18) return true;
  return false;
}

function buildFullQuestionForGeneration(messages: Message[], stableOrFallback: string): string {
  const now = Date.now();
  const recentWindowMs = 120_000;
  const stable = normalizeForQuestionJoin(stableOrFallback);

  const interviewerMessages = messages
    .filter((m) => m.sender === "Interviewer" && m.text?.trim())
    .filter((m) => !m.timestamp || now - m.timestamp <= recentWindowMs)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const chunks = interviewerMessages.map((m) => normalizeForQuestionJoin(m.text)).filter(Boolean);
  if (stable && !chunks.some((chunk) => areNearDuplicateTexts(chunk, stable))) {
    chunks.push(stable);
  }

  if (!chunks.length) return stable;

  // Anchor to the most recent actual question start so old answered questions are not included.
  let startIndex = -1;
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    if (QUESTION_START_RE.test(chunks[i])) {
      startIndex = i;
      break;
    }
  }

  const scoped = startIndex >= 0 ? chunks.slice(startIndex) : chunks;
  const full = scoped
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^(okay|ok|right|great|so|now)[,.;:\s]+/i, "")
    .trim();

  if (stable && isLikelyTailFragment(stable) && full.length > stable.length) return full;
  if (full.split(/\s+/).length >= 12 && full.length > stable.length) return full;
  return stable || full;
}

function shouldKeepAsSingleQuestion(question: string): boolean {
  const q = normalizeForQuestionJoin(question);
  const words = q.split(/\s+/).filter(Boolean).length;
  if (words >= 22) return true;
  if (/\b(introduce yourself|walk me through|business problem|architecture|data flow|responsibilities|challenges|outcomes|optimizations)\b/i.test(q)) return true;
  return false;
}`;

  if (!s.includes(anchor)) {
    throw new Error("Could not find buildOverlayTranscript anchor in ActiveSession/page.tsx");
  }
  s = s.replace(anchor, helper);
}

// Auto answer path: create one reconstructed full question before segmentation.
if (!s.includes("const fullQuestionForGeneration = buildFullQuestionForGeneration(messagesRef.current, stableTranscript);")) {
  s = s.replace(
    `    const segmentedQuestions = segmentQuestions(stableTranscript);
    const segmentsToGenerate =
      segmentedQuestions.length >= 2
        ? segmentedQuestions
        : classification.shouldGroup
          ? [stableTranscript]
          : classification.segments;`,
    `    const fullQuestionForGeneration = buildFullQuestionForGeneration(messagesRef.current, stableTranscript);
    const forceSingleQuestion = shouldKeepAsSingleQuestion(fullQuestionForGeneration);
    const segmentedQuestions = forceSingleQuestion ? [] : segmentQuestions(fullQuestionForGeneration);
    const segmentsToGenerate =
      forceSingleQuestion
        ? [fullQuestionForGeneration]
        : segmentedQuestions.length >= 2
          ? segmentedQuestions
          : classification.shouldGroup
            ? [fullQuestionForGeneration]
            : [fullQuestionForGeneration];

    console.log("[AutoAnswer] Full question reconstruction", {
      stableTranscript: stableTranscript.slice(0, 160),
      fullQuestion: fullQuestionForGeneration.slice(0, 240),
      forceSingleQuestion,
      segmentCount: segmentsToGenerate.length,
    });`,
  );
}

// Auto grouped payload should send full reconstructed question as both transcript and currentQuestion.
s = s.replace(
  `          transcript: stableTranscript,
          currentQuestion: adaptiveCtx.currentQuestion || stableTranscript,`,
  `          transcript: fullQuestionForGeneration,
          currentQuestion: fullQuestionForGeneration,`,
);

// Auto independent payload should still include the full question as transcript context.
s = s.replace(
  `              transcript: segment,
              currentQuestion: segment,`,
  `              transcript: fullQuestionForGeneration,
              currentQuestion: segment,`,
);

// Manual button path: replace last-message-only interviewer context with reconstructed full question.
if (!s.includes("const reconstructedQuestion = buildFullQuestionForGeneration(messagesSnapshot, question || tabInterimSnapshot || micInterimSnapshot);") ) {
  s = s.replace(
    `    question = normalizeSttTranscript(question);

    const contextBuildStartedAt = Date.now();`,
    `    question = normalizeSttTranscript(question);
    const reconstructedQuestion = buildFullQuestionForGeneration(messagesSnapshot, question || tabInterimSnapshot || micInterimSnapshot);
    if (reconstructedQuestion && (reconstructedQuestion.length > question.length || isLikelyTailFragment(question))) {
      console.log("[AI Answer] Reconstructed full question", {
        original: question.slice(0, 160),
        reconstructed: reconstructedQuestion.slice(0, 240),
      });
      question = reconstructedQuestion;
      questionSource = "reconstructed_interviewer_question";
    }

    const contextBuildStartedAt = Date.now();`,
  );
}

// Ensure manual payload current question uses the reconstructed full question when available.
s = s.replace(
  `    const bestCurrentQuestion = adaptiveContext.currentQuestion || question;`,
  `    const bestCurrentQuestion = question || adaptiveContext.currentQuestion;`,
);

save(file, before, s);
console.log(changed.length ? `Patched:\n${changed.join("\n")}` : "No changes needed; frontend question reconstruction already applied.");
