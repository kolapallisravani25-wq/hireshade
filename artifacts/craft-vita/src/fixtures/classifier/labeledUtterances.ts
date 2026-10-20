/**
 * Labeled utterance dataset for the HireShade question classifier (G-016).
 *
 * Label semantics:
 *   label = 1  → an interviewer utterance the assistant SHOULD answer
 *                (direct question, indirect/unpunctuated question, follow-up).
 *   label = 0  → an utterance the assistant MUST NOT answer
 *                (small talk, interviewer call admin, candidate statements,
 *                 candidate coding discussion).
 *
 * Categories exist so the report can show per-category precision/recall and
 * so hard negatives can be asserted individually. Utterances are written the
 * way an interviewer speaks (no perfect written grammar, no guaranteed
 * punctuation other than what STT smart_format would emit).
 *
 * This file is data only — the evaluation harness lives in
 * src/features/session/detection/questionDetectionEval.ts.
 */

export type UtteranceCategory =
  | "direct_question"
  | "indirect_question"
  | "follow_up"
  | "coding_discussion"
  | "small_talk"
  | "interviewer_admin"
  | "statement";

export interface LabeledUtterance {
  id: string;
  text: string;
  label: 0 | 1;
  category: UtteranceCategory;
  /** Optional note explaining why the label is what it is (hard cases). */
  note?: string;
}

export const POSITIVE_CATEGORIES: readonly UtteranceCategory[] = [
  "direct_question",
  "indirect_question",
  "follow_up",
];

export const NEGATIVE_CATEGORIES: readonly UtteranceCategory[] = [
  "coding_discussion",
  "small_talk",
  "interviewer_admin",
  "statement",
];

export const DATASET_DESCRIPTION =
  "120 labeled interviewer/candidate utterances covering direct questions, " +
  "unpunctuated indirect questions, follow-ups, and four hard-negative " +
  "classes (small talk, call admin, candidate statements, coding discussion). " +
  "Includes tricky items: statements containing embedded question words " +
  "(how/what/which/explain) and technical questions containing words the " +
  "call-admin regex used to swallow (latency/network/connection/frozen).";

// ---------------------------------------------------------------------------
// POSITIVES — must fire
// ---------------------------------------------------------------------------

const DIRECT_QUESTIONS: LabeledUtterance[] = [
  { id: "dq-01", label: 1, category: "direct_question", text: "What is the difference between an interface and an abstract class in Java?" },
  { id: "dq-02", label: 1, category: "direct_question", text: "Can you explain the event loop in Node.js?" },
  { id: "dq-03", label: 1, category: "direct_question", text: "How does indexing work in Postgres?" },
  { id: "dq-04", label: 1, category: "direct_question", text: "What happens when you type a URL into the browser?" },
  { id: "dq-05", label: 1, category: "direct_question", text: "Why do we need database transactions?" },
  { id: "dq-06", label: 1, category: "direct_question", text: "When would you use a message queue instead of a direct API call?" },
  { id: "dq-07", label: 1, category: "direct_question", text: "Which HTTP status code should the API return for a validation error?" },
  { id: "dq-08", label: 1, category: "direct_question", text: "Who owns the database schema in a microservices architecture?" },
  { id: "dq-09", label: 1, category: "direct_question", text: "Where would you store session data in a distributed system?" },
  { id: "dq-10", label: 1, category: "direct_question", text: "Is Kubernetes overkill for a monolith?" },
  { id: "dq-11", label: 1, category: "direct_question", text: "Do you prefer REST or GraphQL for this project?" },
  { id: "dq-12", label: 1, category: "direct_question", text: "Should the cache be invalidated on every write?" },
  { id: "dq-13", label: 1, category: "direct_question", text: "Are you familiar with the CAP theorem?" },
  { id: "dq-14", label: 1, category: "direct_question", text: "Could you compare optimistic and pessimistic locking?" },
  { id: "dq-15", label: 1, category: "direct_question", text: "Would you use Redis for rate limiting?" },
  { id: "dq-16", label: 1, category: "direct_question", text: "How do you handle schema migrations in production?" },
  { id: "dq-17", label: 1, category: "direct_question", text: "What is the time complexity of a hash map lookup?" },
  { id: "dq-18", label: 1, category: "direct_question", text: "Describe the difference between processes and threads." },
  { id: "dq-19", label: 1, category: "direct_question", text: "Explain how garbage collection works in the JVM." },
  { id: "dq-20", label: 1, category: "direct_question", text: "Tell me about a production incident you handled." },
  { id: "dq-21", label: 1, category: "direct_question", text: "Give me an example of a bug you debugged recently." },
  { id: "dq-22", label: 1, category: "direct_question", text: "Show me how you would structure a REST API for orders." },
  { id: "dq-23", label: 1, category: "direct_question", text: "Write a function that reverses a linked list." },
  { id: "dq-24", label: 1, category: "direct_question", text: "What's the difference between a left join and an inner join?" },
  { id: "dq-25", label: 1, category: "direct_question", text: "Do you think the current design can handle ten million users?" },
  { id: "dq-26", label: 1, category: "direct_question", text: "Why would you choose gRPC over REST here?" },
  // Technical questions that use words the admin-noise regex used to swallow
  // (latency / network / connection / frozen) — proves admin scoping is precise.
  { id: "dq-27", label: 1, category: "direct_question", text: "How would you reduce tail latency in this service?" },
  { id: "dq-28", label: 1, category: "direct_question", text: "What causes a network partition in a distributed system?" },
  { id: "dq-29", label: 1, category: "direct_question", text: "How do you tune connection pooling for Postgres?" },
  { id: "dq-30", label: 1, category: "direct_question", text: "How do you debug a frozen UI thread?" },
  { id: "dq-31", label: 1, category: "direct_question", text: "What is the difference between a webcam stream and screen capture?" },
];

const INDIRECT_QUESTIONS: LabeledUtterance[] = [
  { id: "iq-01", label: 1, category: "indirect_question", text: "Tell me about yourself." },
  { id: "iq-02", label: 1, category: "indirect_question", text: "Tell me about your last project and your role in it." },
  { id: "iq-03", label: 1, category: "indirect_question", text: "Walk me through your resume." },
  { id: "iq-04", label: 1, category: "indirect_question", text: "Walk me through how you would design a URL shortener." },
  { id: "iq-05", label: 1, category: "indirect_question", text: "How would you design a rate limiter for the public API?" },
  { id: "iq-06", label: 1, category: "indirect_question", text: "How would you approach debugging a memory leak in a Node service?" },
  { id: "iq-07", label: 1, category: "indirect_question", text: "Design a distributed counter that survives node failures." },
  { id: "iq-08", label: 1, category: "indirect_question", text: "Design a notification system that handles millions of users." },
  { id: "iq-09", label: 1, category: "indirect_question", text: "What's the complexity of your solution?" },
  { id: "iq-10", label: 1, category: "indirect_question", text: "What's the time complexity of the algorithm you just proposed?" },
  { id: "iq-11", label: 1, category: "indirect_question", text: "Tell me about a time you disagreed with your manager." },
  { id: "iq-12", label: 1, category: "indirect_question", text: "Describe a situation where you had to push back on a deadline." },
  { id: "iq-13", label: 1, category: "indirect_question", text: "Give me an example of when you improved performance." },
  { id: "iq-14", label: 1, category: "indirect_question", text: "Talk me through how you would test this service." },
  { id: "iq-15", label: 1, category: "indirect_question", text: "Explain your approach to code reviews." },
  { id: "iq-16", label: 1, category: "indirect_question", text: "How would you scale this service to handle ten times the traffic?" },
  { id: "iq-17", label: 1, category: "indirect_question", text: "Suppose the database is down, how would you keep the API responsive?" },
  { id: "iq-18", label: 1, category: "indirect_question", text: "What would you do if the cache and the database disagreed?" },
];

const FOLLOW_UPS: LabeledUtterance[] = [
  { id: "fu-01", label: 1, category: "follow_up", text: "Why did you use Kafka?" },
  { id: "fu-02", label: 1, category: "follow_up", text: "Why did you choose Postgres over MongoDB?" },
  { id: "fu-03", label: 1, category: "follow_up", text: "What about that approach makes it more scalable?" },
  { id: "fu-04", label: 1, category: "follow_up", text: "You mentioned caching earlier, how exactly did you invalidate it?" },
  { id: "fu-05", label: 1, category: "follow_up", text: "Can you elaborate on the sharding strategy?" },
  { id: "fu-06", label: 1, category: "follow_up", text: "And how would you monitor that in production?" },
  { id: "fu-07", label: 1, category: "follow_up", text: "What if the queue backs up under load?" },
  { id: "fu-08", label: 1, category: "follow_up", text: "How about the failure case there?" },
  { id: "fu-09", label: 1, category: "follow_up", text: "Explain more about the retry logic." },
  { id: "fu-10", label: 1, category: "follow_up", text: "You said you used Redis, why not memcached?" },
  { id: "fu-11", label: 1, category: "follow_up", text: "What about the database part?" },
  { id: "fu-12", label: 1, category: "follow_up", text: "Continue from the part about idempotency." },
];

// ---------------------------------------------------------------------------
// HARD NEGATIVES — must not fire
// ---------------------------------------------------------------------------

const CODING_DISCUSSION: LabeledUtterance[] = [
  { id: "cd-01", label: 0, category: "coding_discussion", text: "I would use a hash map here because lookups are O(1)." },
  { id: "cd-02", label: 0, category: "coding_discussion", text: "The function walked through the array and updated the count." },
  { id: "cd-03", label: 0, category: "coding_discussion", text: "My code creates a new array on every render, which causes re-renders." },
  { id: "cd-04", label: 0, category: "coding_discussion", text: "I used a two-pointer approach to solve that problem." },
  { id: "cd-05", label: 0, category: "coding_discussion", text: "The bug was an off-by-one error in the loop condition." },
  { id: "cd-06", label: 0, category: "coding_discussion", text: "I refactored the query to use a composite index." },
  { id: "cd-07", label: 0, category: "coding_discussion", text: "The service exposes a REST endpoint that accepts a payload." },
  { id: "cd-08", label: 0, category: "coding_discussion", text: "I wrapped the call in a retry with exponential backoff." },
  { id: "cd-09", label: 0, category: "coding_discussion", text: "The cache key includes the tenant id and the user id." },
  { id: "cd-10", label: 0, category: "coding_discussion", text: "I added a unit test that covers the null case." },
  { id: "cd-11", label: 0, category: "coding_discussion", text: "We store the offsets in Kafka and commit them every batch." },
  { id: "cd-12", label: 0, category: "coding_discussion", text: "The component takes the data as props and renders a table." },
  { id: "cd-13", label: 0, category: "coding_discussion", text: "Then I memoized the selector so it only recomputes when the filter changes." },
];

const STATEMENTS: LabeledUtterance[] = [
  { id: "st-01", label: 0, category: "statement", text: "I have five years of experience building backend services." },
  { id: "st-02", label: 0, category: "statement", text: "My last role was a senior engineer at a fintech company." },
  { id: "st-03", label: 0, category: "statement", text: "We migrated from a monolith to microservices last year." },
  { id: "st-04", label: 0, category: "statement", text: "The team used Scrum with two-week sprints." },
  { id: "st-05", label: 0, category: "statement", text: "I am comfortable with TypeScript and React." },
  { id: "st-06", label: 0, category: "statement", text: "Our SLA was two hundred milliseconds at the p99." },
  { id: "st-07", label: 0, category: "statement", text: "I led the migration and mentored two junior engineers." },
  { id: "st-08", label: 0, category: "statement", text: "The system handled about ten thousand requests per second." },
  { id: "st-09", label: 0, category: "statement", text: "I know how React handles state reconciliation.", note: "embedded question word 'how' — must stay a statement" },
  { id: "st-10", label: 0, category: "statement", text: "I explained how the cache invalidation worked.", note: "embedded 'explain' stem — must stay a statement" },
  { id: "st-11", label: 0, category: "statement", text: "We decided to use gRPC between the services." },
  { id: "st-12", label: 0, category: "statement", text: "I spent the weekend preparing for system design interviews." },
  { id: "st-13", label: 0, category: "statement", text: "The deployment pipeline runs on GitHub Actions." },
  { id: "st-14", label: 0, category: "statement", text: "We had a meeting with the client yesterday." },
  { id: "st-15", label: 0, category: "statement", text: "I will send you the resume after this call." },
  { id: "st-16", label: 0, category: "statement", text: "I have used Kubernetes for about three years now." },
  { id: "st-17", label: 0, category: "statement", text: "I know what is happening inside the event loop.", note: "embedded 'what is' — must stay a statement" },
];

const SMALL_TALK: LabeledUtterance[] = [
  { id: "sm-01", label: 0, category: "small_talk", text: "Hi, how are you doing today?" },
  { id: "sm-02", label: 0, category: "small_talk", text: "Nice to meet you, thanks for taking the time." },
  { id: "sm-03", label: 0, category: "small_talk", text: "Good morning, hope you had a good weekend." },
  { id: "sm-04", label: 0, category: "small_talk", text: "How's your day going so far?" },
  { id: "sm-05", label: 0, category: "small_talk", text: "Thanks, I appreciate that." },
  { id: "sm-06", label: 0, category: "small_talk", text: "That sounds great, thank you." },
  { id: "sm-07", label: 0, category: "small_talk", text: "No worries at all." },
  { id: "sm-08", label: 0, category: "small_talk", text: "Sounds good, talk to you soon." },
  { id: "sm-09", label: 0, category: "small_talk", text: "Good luck with the rest of your day." },
  { id: "sm-10", label: 0, category: "small_talk", text: "Have a great weekend." },
  { id: "sm-11", label: 0, category: "small_talk", text: "How is the weather there?" },
  { id: "sm-12", label: 0, category: "small_talk", text: "Awesome, that's exciting." },
];

const INTERVIEWER_ADMIN: LabeledUtterance[] = [
  { id: "ia-01", label: 0, category: "interviewer_admin", text: "Can you hear me?" },
  { id: "ia-02", label: 0, category: "interviewer_admin", text: "Are you able to hear me now?" },
  { id: "ia-03", label: 0, category: "interviewer_admin", text: "Can you see my screen?" },
  { id: "ia-04", label: 0, category: "interviewer_admin", text: "Let me share my screen, one moment." },
  { id: "ia-05", label: 0, category: "interviewer_admin", text: "Share your screen please." },
  { id: "ia-06", label: 0, category: "interviewer_admin", text: "I'm going to share my screen now." },
  { id: "ia-07", label: 0, category: "interviewer_admin", text: "Sorry, I was on mute." },
  { id: "ia-08", label: 0, category: "interviewer_admin", text: "Can you unmute yourself?" },
  { id: "ia-09", label: 0, category: "interviewer_admin", text: "Hold on, my connection dropped." },
  { id: "ia-10", label: 0, category: "interviewer_admin", text: "You're breaking up a little, can you repeat that?" },
  { id: "ia-11", label: 0, category: "interviewer_admin", text: "Let's wait a minute for the other interviewer." },
  { id: "ia-12", label: 0, category: "interviewer_admin", text: "We have five minutes left." },
  { id: "ia-13", label: 0, category: "interviewer_admin", text: "Let me rejoin the call." },
  { id: "ia-14", label: 0, category: "interviewer_admin", text: "Can you see the code on my screen?" },
  { id: "ia-15", label: 0, category: "interviewer_admin", text: "I'll send you the link in the chat." },
  { id: "ia-16", label: 0, category: "interviewer_admin", text: "Okay, let's move on to the next section." },
  { id: "ia-17", label: 0, category: "interviewer_admin", text: "Are you ready to start?" },
];

export const LABELED_UTTERANCES: LabeledUtterance[] = [
  ...DIRECT_QUESTIONS,
  ...INDIRECT_QUESTIONS,
  ...FOLLOW_UPS,
  ...CODING_DISCUSSION,
  ...STATEMENTS,
  ...SMALL_TALK,
  ...INTERVIEWER_ADMIN,
];
