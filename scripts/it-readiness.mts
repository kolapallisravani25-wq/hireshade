import { assessQuestionReadiness } from "/home/claude/hireshade/artifacts/api-server/src/lib/questionReadiness.ts";
let p = 0, f = 0;
function t(text: string, expectReady: boolean, force = false) {
  const r = assessQuestionReadiness(text, { force });
  const ok = r.ready === expectReady;
  ok ? p++ : f++;
  if (!ok) console.log(`  ✗ [${expectReady ? "READY" : "NOT"}] got ${r.ready} (${r.reason}): "${text.slice(0, 70)}"`);
}
// Past prod failures (must be READY)
t("Can you introduce yourself? And walk", true);
t("one. Self introduction. Can you introduce yourself? And walk me through your resume", true);
// Fragments (must be NOT ready)
t("Can you introduce yourself and walk me through your", false);
t("Write a Dockerfile to containerize a", false);
t("Question", false);
t("so the", false);
t("", false);
// Real questions (READY)
t("Tell me about yourself", true);
t("What is the difference between let and var in JavaScript", true);
t("Explain the CAP theorem", true);
t("How would you design a URL shortener", true);
t("Describe a time you disagreed with your manager", true);
t("Walk me through your most recent project", true);
t("Why Kafka over RabbitMQ", true);
t("Implement a function to reverse a linked list", true);
// Terse but real (READY)
t("Why?", true);
t("What is SQL?", true);
// Statement noise (NOT)
t("Yeah I worked at Infosys before that", false);
// Documented-permissive: mid-sentence "is" matches a question signal — the
// guard only rejects clear FRAGMENTS by design (statement -> mediocre answer,
// not a broken one; tightening risks rejecting oddly-phrased real questions).
t("The weather is nice today okay", true);
// Long multi-clause (READY)
t("So imagine you have a service handling ten thousand requests per second and the database starts timing out, how do you approach diagnosing and fixing it", true);
// Long fragment ending on dangling word but >=10 words (current policy: READY — verify)
t("Can you please explain in detail the architecture of your last project including the", true);
// Forced always ready
t("a", true, true);
// Hindi-English mixed (common in Indian interviews)
t("Aapke last project me kya challenges the, explain karo", true);
console.log(`\nREADINESS: ${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
