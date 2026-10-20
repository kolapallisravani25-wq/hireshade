/**
 * Mock / demo provider layer (G-001, G-004, G-005, G-014, G-017).
 *
 * Public entrypoint used by the demo harness. Nothing here is imported by the
 * production request path unless a caller opts in.
 */
export * from "./types.js";
export * from "./demoMode.js";
export * from "./demoAuth.js";
export * from "./demoRoutes.js";
export * from "./demoServer.js";
export * from "./mockLlm.js";
export * from "./mockAsr.js";
export * from "./mockTts.js";
export * from "./llmOpenRouter.js";
export * from "./llmRouter.js";
export * from "./asrDeepgram.js";
export * from "./providerSet.js";
export * from "./targetContracts.js";
export * from "./demoChat.js";
