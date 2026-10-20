/**
 * Session "Extra Context/Instructions" limit (G-020).
 *
 * The target caps custom instructions at ~20,000 characters. The client shows a
 * live counter and refuses to submit beyond the cap; the API re-validates the
 * same constant so a crafted request cannot store an oversized prompt. Keep
 * `MAX_INSTRUCTIONS_CHARS` in sync with
 * `artifacts/api-server/src/lib/instructions.ts` (asserted by tests).
 */
export const MAX_INSTRUCTIONS_CHARS = 20_000;

/** Counter turns amber at this point to warn before the hard cap. */
export const INSTRUCTIONS_WARN_AT_CHARS = 18_000;

export const INSTRUCTIONS_TOO_LONG_CODE = "INSTRUCTIONS_TOO_LONG";

export interface InstructionsValidation {
  ok: boolean;
  /** UTF-16 length, matching `<textarea maxLength>` and the server check. */
  length: number;
  /** Characters still available (0 when over limit). */
  remaining: number;
  /** Present only when `ok` is false. */
  error?: string;
}

/** Length in the same unit the server/database sees. */
export function countInstructionsChars(value: string | null | undefined): number {
  return (value ?? "").length;
}

/** Validates a draft instruction string against the 20k cap. */
export function validateInstructions(
  value: string | null | undefined,
): InstructionsValidation {
  const length = countInstructionsChars(value);
  const remaining = Math.max(0, MAX_INSTRUCTIONS_CHARS - length);
  if (length > MAX_INSTRUCTIONS_CHARS) {
    return {
      ok: false,
      length,
      remaining,
      error:
        `Instructions are ${length.toLocaleString()} characters — the limit is ` +
        `${MAX_INSTRUCTIONS_CHARS.toLocaleString()}. Remove ` +
        `${(length - MAX_INSTRUCTIONS_CHARS).toLocaleString()} characters.`,
    };
  }
  return { ok: true, length, remaining };
}

/** "`1,234 / 20,000`" counter label used by the session wizard. */
export function instructionsCounterLabel(value: string | null | undefined): string {
  return `${countInstructionsChars(value).toLocaleString()} / ${MAX_INSTRUCTIONS_CHARS.toLocaleString()}`;
}

/** True once the counter should switch to its warning colour. */
export function isInstructionsNearLimit(value: string | null | undefined): boolean {
  return countInstructionsChars(value) >= INSTRUCTIONS_WARN_AT_CHARS;
}

/** True only when the value is safe to submit. */
export function isInstructionsValid(value: string | null | undefined): boolean {
  return validateInstructions(value).ok;
}
