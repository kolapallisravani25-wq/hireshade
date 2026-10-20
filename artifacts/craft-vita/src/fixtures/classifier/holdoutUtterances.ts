/**
 * Post-freeze HOLDOUT set for the question classifier (generalization check).
 *
 * These utterances were authored AFTER the first tuning pass, with different
 * phrasings and edge cases from the main dataset in
 * labeledUtterances.ts. They are reported separately in
 * docs/evidence/classifier/report.md so the main-set metrics cannot hide
 * overfitting. They were NOT part of the initial rule derivation.
 *
 * Same label semantics as labeledUtterances.ts:
 *   label 1 → interviewer utterance the assistant should answer
 *   label 0 → must NOT fire (small talk, call admin, statements, coding talk)
 */

import type { LabeledUtterance } from "./labeledUtterances";

export const HOLDOUT_UTTERANCES: LabeledUtterance[] = [
  // --- positives: direct questions ---
  { id: "h-dq-01", label: 1, category: "direct_question", text: "What tradeoffs did you consider when picking DynamoDB?" },
  { id: "h-dq-02", label: 1, category: "direct_question", text: "How would you explain a race condition to a junior developer?" },
  { id: "h-dq-03", label: 1, category: "direct_question", text: "Which metrics would you alert on for this service?" },
  { id: "h-dq-04", label: 1, category: "direct_question", text: "Do you have experience with Kafka Streams?" },
  { id: "h-dq-05", label: 1, category: "direct_question", text: "Could you walk me through your debugging process?" },
  { id: "h-dq-06", label: 1, category: "direct_question", text: "What happens to in-flight requests during a rolling deploy?" },
  { id: "h-dq-07", label: 1, category: "direct_question", text: "How would you handle a poison message in the queue?" },
  { id: "h-dq-08", label: 1, category: "direct_question", text: "What is the difference between a webhook and a polling job?" },

  // --- positives: indirect / unpunctuated questions ---
  { id: "h-iq-01", label: 1, category: "indirect_question", text: "Could you tell me about the hardest technical problem you have solved?" },
  { id: "h-iq-02", label: 1, category: "indirect_question", text: "Design an API for a booking system with seat locking." },
  { id: "h-iq-03", label: 1, category: "indirect_question", text: "Give me a rough estimate of the storage you would need." },
  { id: "h-iq-04", label: 1, category: "indirect_question", text: "Suppose traffic doubles overnight, what would break first?" },
  { id: "h-iq-05", label: 1, category: "indirect_question", text: "Explain the tradeoffs between strong and eventual consistency." },
  { id: "h-iq-06", label: 1, category: "indirect_question", text: "Write a query that returns the top ten customers by revenue." },
  { id: "h-iq-07", label: 1, category: "indirect_question", text: "Walk me through the last incident you were on call for." },
  { id: "h-iq-08", label: 1, category: "indirect_question", text: "Tell me why you moved away from the monolith." },

  // --- positives: follow-ups ---
  { id: "h-fu-01", label: 1, category: "follow_up", text: "What about consistency in that design?" },
  { id: "h-fu-02", label: 1, category: "follow_up", text: "Why did you pick a message queue over a cron job?" },
  { id: "h-fu-03", label: 1, category: "follow_up", text: "You mentioned feature flags, how did you roll them out?" },
  { id: "h-fu-04", label: 1, category: "follow_up", text: "Can you go deeper on the partitioning strategy?" },

  // --- negatives: statements ---
  { id: "h-st-01", label: 0, category: "statement", text: "I was the one who introduced Kafka to the team." },
  { id: "h-st-02", label: 0, category: "statement", text: "The migration took about three months of calendar time." },
  { id: "h-st-03", label: 0, category: "statement", text: "We used feature flags to roll out the change safely." },
  { id: "h-st-04", label: 0, category: "statement", text: "I usually start by writing the failing test." },
  { id: "h-st-05", label: 0, category: "statement", text: "That's why we chose a queue over a cron job." },
  { id: "h-st-06", label: 0, category: "statement", text: "The reason I used Redis was to cut down read latency." },
  { id: "h-st-07", label: 0, category: "statement", text: "I know which service owns the user table." },
  { id: "h-st-08", label: 0, category: "statement", text: "She asked whether the cache was warmed before launch." },

  // --- negatives: coding discussion ---
  { id: "h-cd-01", label: 0, category: "coding_discussion", text: "The handler clones the request body before validating it." },
  { id: "h-cd-02", label: 0, category: "coding_discussion", text: "I renamed the variable and moved the logic into a helper." },
  { id: "h-cd-03", label: 0, category: "coding_discussion", text: "The serializer drops unknown fields by default." },

  // --- negatives: small talk ---
  { id: "h-sm-01", label: 0, category: "small_talk", text: "How was your weekend?" },
  { id: "h-sm-02", label: 0, category: "small_talk", text: "Hope you're doing well." },
  { id: "h-sm-03", label: 0, category: "small_talk", text: "Thanks for waiting, let's get started." },
  { id: "h-sm-04", label: 0, category: "small_talk", text: "How do you like the weather today?" },

  // --- negatives: interviewer admin ---
  { id: "h-ia-01", label: 0, category: "interviewer_admin", text: "Am I audible?" },
  { id: "h-ia-02", label: 0, category: "interviewer_admin", text: "Is my screen visible to you?" },
  { id: "h-ia-03", label: 0, category: "interviewer_admin", text: "I'm sharing my screen now." },
  { id: "h-ia-04", label: 0, category: "interviewer_admin", text: "Do you see my cursor?" },
];
