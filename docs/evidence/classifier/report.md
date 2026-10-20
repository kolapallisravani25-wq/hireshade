# Question Classifier Evaluation (G-016)

Generated: 2026-10-20T13:51:13.023Z
Branch: `complete-build` (working tree, uncommitted)
Detector: real local heuristics — **no network calls, no LLM calls**.

## 1. What is measured

The production auto-trigger path is `detectActiveQuestion` fed the stabilized
transcript snapshot as `liveInterimText` (the auto path never feeds raw interim
state). For each utterance the harness calls that exact function and records one
binary decision:

> **DETECTED** ⇔ `source !== "none"`
> ∧ `ignoredNoise === false`
> ∧ `activeQuestion.trim() !== ""`
> ∧ `cleanedQuestion.trim() !== ""`
> ∧ `confidenceScore > 0.75` (strict)

Every other outcome is NOT_DETECTED. Metrics are at **utterance level**:

- **Precision** = TP / (TP + FP) — of the utterances the system fired on, how many were answerable questions.
- **Recall** = TP / (TP + FN) — of the answerable questions, how many fired.

Threshold rationale: the detector's own scoring ladder puts plain statements at
0.70 (0.5 + 0.1 length>10 + 0.1 length>20) and question-form utterances at 1.00,
so 0.75 is a documented separating band, not a calibrated probability.

## 2. Corpus

120 labeled interviewer/candidate utterances covering direct questions, unpunctuated indirect questions, follow-ups, and four hard-negative classes (small talk, call admin, candidate statements, coding discussion). Includes tricky items: statements containing embedded question words (how/what/which/explain) and technical questions containing words the call-admin regex used to swallow (latency/network/connection/frozen).

| Split | Utterances | Positives | Negatives |
|---|---|---|---|
| Main labeled set (CI assertion) | 120 | 61 | 59 |
| Holdout (generalization probe) | 39 | 20 | 19 |
| Untouched check (post-freeze, run once) | 22 | 10 | 12 |

Hard negatives in the main set: small talk (12), interviewer call admin (17), candidate statements (17), coding discussion (13).
Hard positives: unpunctuated indirect questions (18) and follow-ups (12).

## 3. Result — main labeled set

| Metric | Value | Required |
|---|---|---|
| Precision | **1.0000** (100.0%) | ≥ 0.85 |
| Recall | **1.0000** (100.0%) | ≥ 0.90 |
| F1 | 1.0000 | — |
| Accuracy | 1.0000 (100.0%) | — |

**PASS.**

### Before vs after tuning (same harness, same threshold)

| Corpus | Precision | Recall | TP | FP | FN | TN |
|---|---|---|---|---|---|---|
| 115-utterance main set (before dq-27..dq-31 were appended) | 0.8197 | 0.8929 | 50 | 11 | 6 | 48 |
| Main set after tuning (120 utterances) | 1.0000 | 1.0000 | 61 | 0 | 0 | 59 |

The baseline row is a recorded measurement, not a reconstruction: it was captured
with the same evaluate/harness/threshold before any rule change (11 false
positives: embedded question words in statements, small talk, admin; 6 false
negatives: unpunctuated imperatives such as "Walk me through ..." and "Design a ...").
The five extra utterances in the final corpus were added afterwards to cover
technical questions that the old admin regex suppressed.

### Confusion matrix (rows = ground truth, columns = prediction)

|  | Predicted question | Predicted non-question |
|---|---|---|
| **Actual question** | TP = 61 | FN = 0 |
| **Actual non-question** | FP = 0 | TN = 59 |

### Per-category breakdown

| Category | Polarity | N | TP | FP | FN | TN | Precision | Recall | FP rate |
|---|---|---|---|---|---|---|---|---|---|
| direct_question | positive | 31 | 31 | 0 | 0 | 0 | 100.0% | 100.0% | 0.0% |
| indirect_question | positive | 18 | 18 | 0 | 0 | 0 | 100.0% | 100.0% | 0.0% |
| follow_up | positive | 12 | 12 | 0 | 0 | 0 | 100.0% | 100.0% | 0.0% |
| coding_discussion | negative | 13 | 0 | 0 | 0 | 13 | n/a | n/a | 0.0% |
| statement | negative | 17 | 0 | 0 | 0 | 17 | n/a | n/a | 0.0% |
| small_talk | negative | 12 | 0 | 0 | 0 | 12 | n/a | n/a | 0.0% |
| interviewer_admin | negative | 17 | 0 | 0 | 0 | 17 | n/a | n/a | 0.0% |

Every negative category has a 0% false-positive rate on the main set, including
small talk and interviewer admin — `ignoredNoise` blocks them before confidence
is considered.

False positives on the main set: _None._

False negatives on the main set: _None._

### Secondary splits (not CI gates on their own)

| Split | Precision | Recall | F1 | FP | FN |
|---|---|---|---|---|---|
| Holdout | 1.0000 | 1.0000 | 1.0000 | 0 | 0 |
| Untouched check | 0.9091 | 1.0000 | 0.9524 | 1 | 0 |

The holdout set is *pseudo-independent*: its first pass surfaced two small-talk
gaps and one admin gap that were then fixed, so it is reported as a robustness
probe. The untouched check set was authored and evaluated only after all rules
were frozen; its single residual false positive is documented below.

## 4. Heuristic changes (minimal, no LLM, no network)

1. **`src/lib/intent-detector.ts`** — isQuestion(): replaced unanchored substring matching over 20 question words with (a) '?' check, (b) start-word check against QUESTION_START_WORDS (wh-words, auxiliaries, interview imperatives such as tell/walk/design/give/write/continue), and (c) word-boundary matching for EMBEDDED_QUESTION_OPENERS.

   _Why:_ Substring matching made statements containing 'how'/'which'/'when'/'explain' fire (e.g. 'My code creates a new array ... which causes re-renders', 'I explained how the cache invalidation worked') and made unpunctuated imperatives ('Walk me through ...', 'Design a ...', 'Continue from ...', 'Write a function ...') not fire.

2. **`src/features/session/detection/activeQuestionDetector.ts`** — ADMIN_NOISE_RE rewritten to match explicit call-management phrases only; bare device/network words (camera, mic, connection, network, latency, lag, frozen, ...) no longer suppress a whole utterance.

   _Why:_ The old regex suppressed genuine technical questions such as 'How would you reduce tail latency in this service?' or 'How do you debug a frozen UI thread?'. Added explicit screen/audio/A-V phrases ('see my screen/cursor', 'share my screen', 'on mute', 'connection dropped', 'breaking up', 'link in the chat', 'ready to start').

3. **`src/features/session/detection/activeQuestionDetector.ts`** — Added SMALL_TALK_RE and wired it into build(): small talk is treated as noise (ignoredNoise=true) and receives the same -0.3 confidence penalty as admin noise.

   _Why:_ Pleasantries phrased as questions ('how are you doing today?', "how's your day going?", 'how was your weekend?', 'how do you like the weather?') were confidently detected and would have triggered an answer. Requirement: never fire on small talk.

4. **`src/features/session/detection/questionDetectionEval.ts`** — Added the evaluation harness: evaluateUtterance() calls the real detectActiveQuestion() live_interim path and applies the documented fire rule (source!=none ∧ !ignoredNoise ∧ non-empty activeQuestion/cleanedQuestion ∧ confidenceScore > 0.75); computeMetrics() builds utterance-level precision/recall.

   _Why:_ G-016 had no labeled set and no metrics. 0.75 was chosen because the detector's own ladder puts statements at 0.70 and question-form utterances at 1.00.

## 5. Known limitations

- Measured at single-utterance level only. Multi-sentence merged STT snapshots are exercised by the existing detector tests but are not scored in this dataset.
- The untouched check set contains one residual false positive: 'Is my audio coming through?' ('audio coming through' is not yet in ADMIN_NOISE_RE). It was deliberately left unfixed so the check set remains an honest post-freeze measurement; main-set thresholds are unaffected.
- Heuristics are declarative regex/word-list rules, not a trained model. The rules were derived from the main set (and a later robustness pass informed by the holdout set); the untouched set is the closest thing to a blind measurement here.
- The detector's confidence score is coarse (0.70 statement band vs 1.00 question band); the 0.75 threshold is a separating band, not a calibrated probability.

## 6. Reproduction

```bash
# CI gate (assertions only)
cd artifacts/craft-vita
pnpm exec vitest run src/features/session/detection/classifierMetrics.test.ts

# Regenerate this report + metrics.json
CLASSIFIER_EVIDENCE_DIR=../../docs/evidence/classifier pnpm exec vitest run src/features/session/detection/classifierMetrics.test.ts

# Whole frontend suite (must stay green)
pnpm --dir artifacts/craft-vita test
```

## 7. Per-utterance decisions (main set)

| ID | Category | Expected | Decision | Confidence | Ignored as noise | Utterance |
|---|---|---|---|---|---|---|
| dq-01 | direct_question | question | FIRED | 1.0000 | no | What is the difference between an interface and an abstract class in Java? |
| dq-02 | direct_question | question | FIRED | 1.0000 | no | Can you explain the event loop in Node.js? |
| dq-03 | direct_question | question | FIRED | 1.0000 | no | How does indexing work in Postgres? |
| dq-04 | direct_question | question | FIRED | 1.0000 | no | What happens when you type a URL into the browser? |
| dq-05 | direct_question | question | FIRED | 1.0000 | no | Why do we need database transactions? |
| dq-06 | direct_question | question | FIRED | 1.0000 | no | When would you use a message queue instead of a direct API call? |
| dq-07 | direct_question | question | FIRED | 1.0000 | no | Which HTTP status code should the API return for a validation error? |
| dq-08 | direct_question | question | FIRED | 1.0000 | no | Who owns the database schema in a microservices architecture? |
| dq-09 | direct_question | question | FIRED | 1.0000 | no | Where would you store session data in a distributed system? |
| dq-10 | direct_question | question | FIRED | 1.0000 | no | Is Kubernetes overkill for a monolith? |
| dq-11 | direct_question | question | FIRED | 1.0000 | no | Do you prefer REST or GraphQL for this project? |
| dq-12 | direct_question | question | FIRED | 1.0000 | no | Should the cache be invalidated on every write? |
| dq-13 | direct_question | question | FIRED | 1.0000 | no | Are you familiar with the CAP theorem? |
| dq-14 | direct_question | question | FIRED | 1.0000 | no | Could you compare optimistic and pessimistic locking? |
| dq-15 | direct_question | question | FIRED | 1.0000 | no | Would you use Redis for rate limiting? |
| dq-16 | direct_question | question | FIRED | 1.0000 | no | How do you handle schema migrations in production? |
| dq-17 | direct_question | question | FIRED | 1.0000 | no | What is the time complexity of a hash map lookup? |
| dq-18 | direct_question | question | FIRED | 1.0000 | no | Describe the difference between processes and threads. |
| dq-19 | direct_question | question | FIRED | 1.0000 | no | Explain how garbage collection works in the JVM. |
| dq-20 | direct_question | question | FIRED | 1.0000 | no | Tell me about a production incident you handled. |
| dq-21 | direct_question | question | FIRED | 1.0000 | no | Give me an example of a bug you debugged recently. |
| dq-22 | direct_question | question | FIRED | 1.0000 | no | Show me how you would structure a REST API for orders. |
| dq-23 | direct_question | question | FIRED | 1.0000 | no | Write a function that reverses a linked list. |
| dq-24 | direct_question | question | FIRED | 1.0000 | no | What's the difference between a left join and an inner join? |
| dq-25 | direct_question | question | FIRED | 1.0000 | no | Do you think the current design can handle ten million users? |
| dq-26 | direct_question | question | FIRED | 1.0000 | no | Why would you choose gRPC over REST here? |
| dq-27 | direct_question | question | FIRED | 1.0000 | no | How would you reduce tail latency in this service? |
| dq-28 | direct_question | question | FIRED | 1.0000 | no | What causes a network partition in a distributed system? |
| dq-29 | direct_question | question | FIRED | 1.0000 | no | How do you tune connection pooling for Postgres? |
| dq-30 | direct_question | question | FIRED | 1.0000 | no | How do you debug a frozen UI thread? |
| dq-31 | direct_question | question | FIRED | 1.0000 | no | What is the difference between a webcam stream and screen capture? |
| iq-01 | indirect_question | question | FIRED | 1.0000 | no | Tell me about yourself. |
| iq-02 | indirect_question | question | FIRED | 1.0000 | no | Tell me about your last project and your role in it. |
| iq-03 | indirect_question | question | FIRED | 1.0000 | no | Walk me through your resume. |
| iq-04 | indirect_question | question | FIRED | 1.0000 | no | Walk me through how you would design a URL shortener. |
| iq-05 | indirect_question | question | FIRED | 1.0000 | no | How would you design a rate limiter for the public API? |
| iq-06 | indirect_question | question | FIRED | 1.0000 | no | How would you approach debugging a memory leak in a Node service? |
| iq-07 | indirect_question | question | FIRED | 1.0000 | no | Design a distributed counter that survives node failures. |
| iq-08 | indirect_question | question | FIRED | 1.0000 | no | Design a notification system that handles millions of users. |
| iq-09 | indirect_question | question | FIRED | 1.0000 | no | What's the complexity of your solution? |
| iq-10 | indirect_question | question | FIRED | 1.0000 | no | What's the time complexity of the algorithm you just proposed? |
| iq-11 | indirect_question | question | FIRED | 1.0000 | no | Tell me about a time you disagreed with your manager. |
| iq-12 | indirect_question | question | FIRED | 1.0000 | no | Describe a situation where you had to push back on a deadline. |
| iq-13 | indirect_question | question | FIRED | 1.0000 | no | Give me an example of when you improved performance. |
| iq-14 | indirect_question | question | FIRED | 1.0000 | no | Talk me through how you would test this service. |
| iq-15 | indirect_question | question | FIRED | 1.0000 | no | Explain your approach to code reviews. |
| iq-16 | indirect_question | question | FIRED | 1.0000 | no | How would you scale this service to handle ten times the traffic? |
| iq-17 | indirect_question | question | FIRED | 1.0000 | no | Suppose the database is down, how would you keep the API responsive? |
| iq-18 | indirect_question | question | FIRED | 1.0000 | no | What would you do if the cache and the database disagreed? |
| fu-01 | follow_up | question | FIRED | 1.0000 | no | Why did you use Kafka? |
| fu-02 | follow_up | question | FIRED | 1.0000 | no | Why did you choose Postgres over MongoDB? |
| fu-03 | follow_up | question | FIRED | 1.0000 | no | What about that approach makes it more scalable? |
| fu-04 | follow_up | question | FIRED | 1.0000 | no | You mentioned caching earlier, how exactly did you invalidate it? |
| fu-05 | follow_up | question | FIRED | 1.0000 | no | Can you elaborate on the sharding strategy? |
| fu-06 | follow_up | question | FIRED | 1.0000 | no | And how would you monitor that in production? |
| fu-07 | follow_up | question | FIRED | 1.0000 | no | What if the queue backs up under load? |
| fu-08 | follow_up | question | FIRED | 1.0000 | no | How about the failure case there? |
| fu-09 | follow_up | question | FIRED | 1.0000 | no | Explain more about the retry logic. |
| fu-10 | follow_up | question | FIRED | 1.0000 | no | You said you used Redis, why not memcached? |
| fu-11 | follow_up | question | FIRED | 1.0000 | no | What about the database part? |
| fu-12 | follow_up | question | FIRED | 1.0000 | no | Continue from the part about idempotency. |
| cd-01 | coding_discussion | non-question | silent | 0.7000 | no | I would use a hash map here because lookups are O(1). |
| cd-02 | coding_discussion | non-question | silent | 0.7000 | no | The function walked through the array and updated the count. |
| cd-03 | coding_discussion | non-question | silent | 0.7000 | no | My code creates a new array on every render, which causes re-renders. |
| cd-04 | coding_discussion | non-question | silent | 0.7000 | no | I used a two-pointer approach to solve that problem. |
| cd-05 | coding_discussion | non-question | silent | 0.7000 | no | The bug was an off-by-one error in the loop condition. |
| cd-06 | coding_discussion | non-question | silent | 0.7000 | no | I refactored the query to use a composite index. |
| cd-07 | coding_discussion | non-question | silent | 0.7000 | no | The service exposes a REST endpoint that accepts a payload. |
| cd-08 | coding_discussion | non-question | silent | 0.7000 | no | I wrapped the call in a retry with exponential backoff. |
| cd-09 | coding_discussion | non-question | silent | 0.7000 | no | The cache key includes the tenant id and the user id. |
| cd-10 | coding_discussion | non-question | silent | 0.7000 | no | I added a unit test that covers the null case. |
| cd-11 | coding_discussion | non-question | silent | 0.7000 | no | We store the offsets in Kafka and commit them every batch. |
| cd-12 | coding_discussion | non-question | silent | 0.7000 | no | The component takes the data as props and renders a table. |
| cd-13 | coding_discussion | non-question | silent | 0.7000 | no | Then I memoized the selector so it only recomputes when the filter changes. |
| st-01 | statement | non-question | silent | 0.7000 | no | I have five years of experience building backend services. |
| st-02 | statement | non-question | silent | 0.7000 | no | My last role was a senior engineer at a fintech company. |
| st-03 | statement | non-question | silent | 0.7000 | no | We migrated from a monolith to microservices last year. |
| st-04 | statement | non-question | silent | 0.7000 | no | The team used Scrum with two-week sprints. |
| st-05 | statement | non-question | silent | 0.7000 | no | I am comfortable with TypeScript and React. |
| st-06 | statement | non-question | silent | 0.7000 | no | Our SLA was two hundred milliseconds at the p99. |
| st-07 | statement | non-question | silent | 0.7000 | no | I led the migration and mentored two junior engineers. |
| st-08 | statement | non-question | silent | 0.7000 | no | The system handled about ten thousand requests per second. |
| st-09 | statement | non-question | silent | 0.7000 | no | I know how React handles state reconciliation. |
| st-10 | statement | non-question | silent | 0.7000 | no | I explained how the cache invalidation worked. |
| st-11 | statement | non-question | silent | 0.7000 | no | We decided to use gRPC between the services. |
| st-12 | statement | non-question | silent | 0.7000 | no | I spent the weekend preparing for system design interviews. |
| st-13 | statement | non-question | silent | 0.7000 | no | The deployment pipeline runs on GitHub Actions. |
| st-14 | statement | non-question | silent | 0.7000 | no | We had a meeting with the client yesterday. |
| st-15 | statement | non-question | silent | 0.7000 | no | I will send you the resume after this call. |
| st-16 | statement | non-question | silent | 0.7000 | no | I have used Kubernetes for about three years now. |
| st-17 | statement | non-question | silent | 0.7000 | no | I know what is happening inside the event loop. |
| sm-01 | small_talk | non-question | silent | 0.7000 | yes | Hi, how are you doing today? |
| sm-02 | small_talk | non-question | silent | 0.4000 | yes | Nice to meet you, thanks for taking the time. |
| sm-03 | small_talk | non-question | silent | 0.4000 | yes | Good morning, hope you had a good weekend. |
| sm-04 | small_talk | non-question | silent | 0.7000 | yes | How's your day going so far? |
| sm-05 | small_talk | non-question | silent | 0.4000 | yes | Thanks, I appreciate that. |
| sm-06 | small_talk | non-question | silent | 0.4000 | yes | That sounds great, thank you. |
| sm-07 | small_talk | non-question | silent | 0.3000 | yes | No worries at all. |
| sm-08 | small_talk | non-question | silent | 0.4000 | yes | Sounds good, talk to you soon. |
| sm-09 | small_talk | non-question | silent | 0.4000 | yes | Good luck with the rest of your day. |
| sm-10 | small_talk | non-question | silent | 0.7000 | yes | Have a great weekend. |
| sm-11 | small_talk | non-question | silent | 0.7000 | yes | How is the weather there? |
| sm-12 | small_talk | non-question | silent | 0.1200 | yes | Awesome, that's exciting. |
| ia-01 | interviewer_admin | non-question | silent | 0.7000 | yes | Can you hear me? |
| ia-02 | interviewer_admin | non-question | silent | 0.7000 | yes | Are you able to hear me now? |
| ia-03 | interviewer_admin | non-question | silent | 0.7000 | yes | Can you see my screen? |
| ia-04 | interviewer_admin | non-question | silent | 0.4000 | yes | Let me share my screen, one moment. |
| ia-05 | interviewer_admin | non-question | silent | 0.7000 | yes | Share your screen please. |
| ia-06 | interviewer_admin | non-question | silent | 0.4000 | yes | I'm going to share my screen now. |
| ia-07 | interviewer_admin | non-question | silent | 0.3000 | yes | Sorry, I was on mute. |
| ia-08 | interviewer_admin | non-question | silent | 0.7000 | yes | Can you unmute yourself? |
| ia-09 | interviewer_admin | non-question | silent | 0.4000 | yes | Hold on, my connection dropped. |
| ia-10 | interviewer_admin | non-question | silent | 0.7000 | yes | You're breaking up a little, can you repeat that? |
| ia-11 | interviewer_admin | non-question | silent | 0.4000 | yes | Let's wait a minute for the other interviewer. |
| ia-12 | interviewer_admin | non-question | silent | 0.4000 | yes | We have five minutes left. |
| ia-13 | interviewer_admin | non-question | silent | 0.4000 | yes | Let me rejoin the call. |
| ia-14 | interviewer_admin | non-question | silent | 0.7000 | yes | Can you see the code on my screen? |
| ia-15 | interviewer_admin | non-question | silent | 0.4000 | yes | I'll send you the link in the chat. |
| ia-16 | interviewer_admin | non-question | silent | 0.4000 | yes | Okay, let's move on to the next section. |
| ia-17 | interviewer_admin | non-question | silent | 0.7000 | yes | Are you ready to start? |
