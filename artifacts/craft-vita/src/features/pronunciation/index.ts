/**
 * Pronunciation-robust understanding (G-039) - public surface.
 *
 * Self-contained modules layered on top of the existing ASR seam:
 *   doubleMetaphone  vendored phonetic encoder (pure TS)
 *   phonetics        phonetic key/similarity/edit-distance helpers
 *   phonemeMap       domain terms, known decoder confusions, homophone cues
 *   vocabulary       resume/JD/company/tech vocabulary builder
 *   rescue           phonetic rescue for low-confidence tokens only
 *   repair           targeted <150 ms repair pass (mock + LlmProvider adapter)
 *   confidenceGate   answer / hedge / clarify decision
 *   codeSwitch       primary+secondary language hints, answer-language pin
 *   ttsLexicon       interviewer pronunciation lexicon + SSML builder
 *   understanding    orchestrator used by the demo pipeline behind a flag
 */
export * from "./types";
export * from "./doubleMetaphone";
export * from "./phonetics";
export * from "./phonemeMap";
export * from "./vocabulary";
export * from "./text";
export * from "./rescue";
export * from "./repair";
export * from "./confidenceGate";
export * from "./codeSwitch";
export * from "./ttsLexicon";
export * from "./understanding";
export * from "./demoHook";
