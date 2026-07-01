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

// Strengthen context handling for practice/review response suggestions.
{
  const p = "artifacts/api-server/src/lib/interviewPrompt.ts";
  let s = read(p);
  const before = s;

  const start = s.indexOf("  const parts: string[] = [");
  if (start !== -1) {
    const end = s.indexOf("  ];", start) + 4;
    const replacement = `  const parts: string[] = [
    "You are the HireShade practice and review coaching engine.",
    "Create a structured response draft for interview preparation, review, or practice.",
    "Do not act as the interviewer. Do not ask questions back. Do not evaluate unless asked for feedback.",
    "Do not start with 'Answer:' because the UI already adds labels.",
    "Detect the full question from transcript text; do not over-prioritize a short trailing fragment.",
    "When the prompt asks for an introduction or project walkthrough, cover profile summary, recent project, business problem, architecture, data flow, role, challenges, resolution, and outcomes.",
    "Ground the response in the selected resume, project, job description, custom prompt, and transcript context when available.",
    "Do not invent unrelated cloud, DevOps, Kubernetes, Terraform, SRE, or fake metrics unless they are present in the provided context.",
    "Use only available metrics; otherwise describe outcomes qualitatively.",
    "Make the response natural, specific, and concise.",
    "Use clean markdown and bold important keywords using **keyword**.",
    "For technical responses include relevant tools, architecture, checks, tradeoffs, and recovery steps.",
    "For code responses include fenced code blocks with language labels.",
    "For behavioral responses use Situation → Action → Result when useful.",
    "If plain-language mode is enabled, include a short simple explanation.",
  ];`;
    s = s.slice(0, start) + replacement + s.slice(end);
  }

  save(p, before, s);
}

{
  const p = "artifacts/api-server/src/routes/sessions.ts";
  let s = read(p);
  const before = s;

  s = s.replace('process.env["OPENROUTER_MAX_TOKENS"] ?? "400"', 'process.env["OPENROUTER_MAX_TOKENS"] ?? "1200"');
  s = s.replace(/:\s*400;/, ': 1200;');

  if (!s.includes("function compactAnswerContext(")) {
    const anchor = `function activeSessionConflict(id: string) {
  const token = \`ACTIVE_SESSION_EXISTS:\${id}\`;
  return { error: token, message: token };
}`;
    const helpers = `${anchor}

function compactAnswerContext(value: unknown, maxChars = 6000): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function looksLikeTrailingFragment(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    v.length < 100 &&
    (v.includes("as you would in a real interview") ||
      v.includes("assume i'm the interviewer") ||
      v.includes("assume i’m the interviewer"))
  );
}

function chooseBestQuestion(body: {
  transcript?: string;
  currentQuestion?: string;
  patchedTranscript?: string;
}): string {
  const patched = compactAnswerContext(body.patchedTranscript, 7000);
  const current = compactAnswerContext(body.currentQuestion, 2500);
  const transcript = compactAnswerContext(body.transcript, 7000);

  if (patched && !looksLikeTrailingFragment(patched)) return patched;
  if (transcript && (!current || looksLikeTrailingFragment(current) || transcript.length > current.length * 2)) return transcript;
  return current || patched || transcript;
}

function buildAnswerUserPrompt(body: {
  transcript?: string;
  currentQuestion?: string;
  patchedTranscript?: string;
  previousAiAnswer?: string;
  regenerateInstruction?: string;
  answerMode?: string;
}): string {
  const question = chooseBestQuestion(body);
  const transcript = compactAnswerContext(body.transcript, 7000);
  const current = compactAnswerContext(body.currentQuestion, 2500);
  const sections = [
    "Create a response draft for practice/review based on the full question.",
    "Use the full interviewer question, not only the last transcript fragment.",
    `FULL QUESTION:\n${question}`,
  ];

  if (current && current !== question) sections.push(`DETECTED SHORT FRAGMENT:\n${current}`);
  if (transcript && transcript !== question) sections.push(`FULL TRANSCRIPT CONTEXT:\n${transcript}`);
  if (body.previousAiAnswer) sections.push(`PREVIOUS RESPONSE TO IMPROVE:\n${compactAnswerContext(body.previousAiAnswer, 2500)}`);
  if (body.regenerateInstruction) sections.push(`REVISION INSTRUCTION:\n${compactAnswerContext(body.regenerateInstruction, 1000)}`);
  if (body.answerMode) sections.push(`ANSWER MODE:\n${compactAnswerContext(body.answerMode, 200)}`);

  return sections.join("\n\n");
}`;
    s = s.replace(anchor, helpers);
  }

  const oldQuestionBlock = `    const question =
      body.patchedTranscript?.trim() ||
      body.currentQuestion?.trim() ||
      body.transcript?.trim() ||
      "";`;
  s = s.replace(oldQuestionBlock, `    const question = chooseBestQuestion(body);`);

  s = s.replace(
    `      messages.push({
        role: "user",
        content: \`Revise the previous answer per this instruction: \${body.regenerateInstruction}\n\nOriginal question: \${question}\`,
      });`,
    `      messages.push({ role: "user", content: buildAnswerUserPrompt(body) });`,
  );
  s = s.replace(
    `      messages.push({ role: "user", content: question });`,
    `      messages.push({ role: "user", content: buildAnswerUserPrompt(body) });`,
  );

  s = s.replace(
    "const aiModel = body.aiModel || session.aiModel || undefined;",
    'const aiModel = process.env["ANSWER_MODEL"] || session.aiModel || undefined;',
  );
  s = s.replace(
    'const aiModel = (req.body?.["aiModel"] as string) || session.aiModel || undefined;',
    'const aiModel = process.env["ANSWER_MODEL"] || session.aiModel || undefined;',
  );

  s = s.replace(/res\.write\(`\*\*QUESTION:\*\* \$\{question\}\\n\*\*ANSWER:\*\* `\);/g, "");

  save(p, before, s);
}

console.log(changed.length ? `Patched:\n${changed.join("\n")}` : "No changes needed; context coaching patch already applied.");
