/**
 * Server-side enforcement of the ~20,000-char session instructions cap (G-020).
 * Mirrors `artifacts/craft-vita/src/lib/instructions.ts`; the client counter is a
 * UX affordance, THIS check is the security boundary (create-session accepts
 * multipart form fields that a crafted client can make arbitrarily large).
 */
export const MAX_INSTRUCTIONS_CHARS = 20_000;

export const INSTRUCTIONS_TOO_LONG_CODE = "INSTRUCTIONS_TOO_LONG";

export interface InstructionsValidation {
  ok: boolean;
  length: number;
  remaining: number;
  error?: string;
}

export function countInstructionsChars(value: string | null | undefined): number {
  return (value ?? "").length;
}

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
        `Instructions are ${length} characters — the limit is ${MAX_INSTRUCTIONS_CHARS}. ` +
        `Remove ${length - MAX_INSTRUCTIONS_CHARS} characters.`,
    };
  }
  return { ok: true, length, remaining };
}

/** 400 body returned by routes that reject an oversized instructions field. */
export function instructionsTooLongPayload(value: string | null | undefined): {
  error: string;
  message: string;
  code: string;
  maxChars: number;
  length: number;
} {
  const validation = validateInstructions(value);
  return {
    error: validation.error ?? `Instructions exceed ${MAX_INSTRUCTIONS_CHARS} characters`,
    message: validation.error ?? `Instructions exceed ${MAX_INSTRUCTIONS_CHARS} characters`,
    code: INSTRUCTIONS_TOO_LONG_CODE,
    maxChars: MAX_INSTRUCTIONS_CHARS,
    length: validation.length,
  };
}
