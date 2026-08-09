/**
 * Mini-Phase B — auto-generation question-source invariant.
 *
 * Root cause fixed: handleAiAnswerClick("auto") used to independently
 * re-resolve "the active question" from live component state
 * (tabInterimTranscript) at call time, instead of using the exact
 * stabilized/classified snapshot that caused autoGenFireRef to fire. Because
 * this is an async function, live state can race ahead to a newer,
 * still-forming interim fragment (e.g. "And can you give a...") by the time
 * it actually runs — that fragment would then get generated AND marked
 * answered, before the full utterance ever finished.
 *
 * Extracted as a pure function (matching the autoScrollPolicy.ts pattern
 * used elsewhere in this codebase) so the origin-aware selection rule is
 * unit-testable without rendering the hook — the vitest environment here is
 * "node", with no DOM/hook-rendering harness anywhere in this repo.
 *
 * Invariant: for origin === "auto", the caller MUST supply a non-empty
 * stabilizedQuestion. The auto path must NEVER fall back to live interim
 * text — that fallback is exactly the race condition being fixed. When the
 * invariant is violated, this returns null so the caller can fail safely
 * (skip generation) instead of silently reading live state.
 *
 * Manual origins (overlay_click, manual_click) never supply a stabilized
 * snapshot and always resolve from current live interim text, unchanged.
 */

export type AiAnswerOrigin = "overlay_click" | "manual_click" | "auto";

/**
 * Resolve the text handleAiAnswerClick should treat as "live interim" for
 * this invocation.
 *
 * @returns the resolved text, or `null` if origin === "auto" but no
 *          non-empty stabilizedQuestion was supplied (invariant violation —
 *          caller must skip generation, not fall back to liveTabInterimText).
 */
export function resolveEffectiveLiveInterimText(
  origin: AiAnswerOrigin,
  stabilizedQuestion: string | undefined,
  liveTabInterimText: string,
): string | null {
  if (origin === "auto") {
    const stabilized = (stabilizedQuestion ?? "").trim();
    return stabilized.length > 0 ? stabilized : null;
  }
  return liveTabInterimText.trim();
}
