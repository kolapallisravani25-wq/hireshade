/**
 * UNTOUCHED CHECK SET (post-freeze, evaluated once, never used for tuning).
 *
 * Authored after all heuristic changes were frozen. Reported in
 * docs/evidence/classifier/report.md as a generalization snapshot; the CI
 * assertion baseline remains the main labeled dataset.
 */
import type { LabeledUtterance } from "./labeledUtterances";

export const UNTOUCHED_CHECK_UTTERANCES: LabeledUtterance[] = [
  // positives
  { id: "u-p-01", label: 1, category: "direct_question", text: "Can you give me an example of a time you resolved a conflict on your team?" },
  { id: "u-p-02", label: 1, category: "direct_question", text: "How might you detect a memory leak in production?" },
  { id: "u-p-03", label: 1, category: "direct_question", text: "What's the difference between horizontal and vertical scaling?" },
  { id: "u-p-04", label: 1, category: "indirect_question", text: "Please walk me through the architecture of your last project." },
  { id: "u-p-05", label: 1, category: "indirect_question", text: "Describe how you would monitor this service after launch." },
  { id: "u-p-06", label: 1, category: "indirect_question", text: "If you had to design a chat app, where would you start?" },
  { id: "u-p-07", label: 1, category: "indirect_question", text: "Tell me about a bug that took you days to find." },
  { id: "u-p-08", label: 1, category: "follow_up", text: "Why do you think the previous approach failed?" },
  { id: "u-p-09", label: 1, category: "follow_up", text: "How would you test that migration without downtime?" },
  { id: "u-p-10", label: 1, category: "follow_up", text: "Could you explain what idempotency means in practice?" },

  // negatives
  { id: "u-n-01", label: 0, category: "statement", text: "I would probably add a circuit breaker there." },
  { id: "u-n-02", label: 0, category: "statement", text: "The team decided to postpone that work to next quarter." },
  { id: "u-n-03", label: 0, category: "statement", text: "We already had a load balancer in front of it." },
  { id: "u-n-04", label: 0, category: "statement", text: "My manager was happy with the outcome." },
  { id: "u-n-05", label: 0, category: "coding_discussion", text: "Then we rolled back and investigated the logs." },
  { id: "u-n-06", label: 0, category: "coding_discussion", text: "The query planner chose a sequential scan instead." },
  { id: "u-n-07", label: 0, category: "small_talk", text: "How are things at your current company?" },
  { id: "u-n-08", label: 0, category: "small_talk", text: "Thanks, that makes sense." },
  { id: "u-n-09", label: 0, category: "interviewer_admin", text: "Can you hear me at all?" },
  { id: "u-n-10", label: 0, category: "interviewer_admin", text: "Is my audio coming through?" },
  { id: "u-n-11", label: 0, category: "interviewer_admin", text: "I'll paste the code into the chat." },
  { id: "u-n-12", label: 0, category: "interviewer_admin", text: "Sorry, my video froze." },
];
