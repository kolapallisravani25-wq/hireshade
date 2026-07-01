/**
 * Centralized fetch helper for credit-deducting AI endpoints.
 *
 * Responsibilities:
 *   1. Generates a UUID idempotency key per logical action so duplicate
 *      clicks / retries / network replays NEVER double-bill the user.
 *   2. Surfaces server-reported `creditsUsed`, `creditsRemaining`, and
 *      `cached` flags so the UI can show accurate cost feedback.
 *   3. Maps server errors (402 insufficient credits, 409 idempotency
 *      conflict) into typed exceptions consumers can render distinctly.
 *
 * Usage:
 *
 *   const key = createIdempotencyKey();
 *   const result = await postCreditedAi(
 *     ENDPOINTS.resumeBuilderEnhanceSection(),
 *     { userId, sectionId, currentText },
 *     { token, idempotencyKey: key },
 *   );
 *   refreshCreditsBalance();
 */

export interface CreditedAiResponse<T> {
  /** The endpoint-specific payload (everything except meter fields). */
  data: T;
  /** Credits actually charged for this call (0 if served from cache). */
  creditsUsed: number;
  /** Updated balance after the charge. */
  creditsRemaining: number;
  /** True if the response came from idempotency replay or generation cache. */
  cached: boolean;
}

export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
  constructor(message = "Insufficient credits") {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  constructor(message = "Operation already in progress") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

/**
 * Generates a fresh UUID for one logical user action. Use a NEW key for
 * each new click — but reuse the SAME key when the SAME click is retried
 * (e.g. after a transient network error) so the server returns the cached
 * result instead of charging again.
 */
export function createIdempotencyKey(): string {
  // crypto.randomUUID() is supported in all evergreen browsers and Tauri.
  return crypto.randomUUID();
}

interface PostOpts {
  token?: string | null;
  idempotencyKey?: string | null;
  signal?: AbortSignal;
}

/**
 * POST to a credit-deducting AI endpoint with idempotency + meter parsing.
 * Splits the response into `data` (endpoint payload) and meter fields.
 */
export async function postCreditedAi<T>(
  url: string,
  body: unknown,
  opts: PostOpts = {},
): Promise<CreditedAiResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON response — fall through to generic error handling.
  }

  if (!res.ok) {
    const message = json?.error || json?.message || `Request failed (${res.status})`;
    if (res.status === 402) throw new InsufficientCreditsError(message);
    if (res.status === 409) throw new IdempotencyConflictError(message);
    throw new Error(message);
  }

  // Tolerate both `{ success, data: {...} }` and flat payloads (legacy).
  const root = json?.data ?? json ?? {};

  const creditsUsed =
    typeof root.creditsUsed === "number" ? root.creditsUsed : 0;
  const creditsRemaining =
    typeof root.creditsRemaining === "number" ? root.creditsRemaining : NaN;
  const cached = root.cached === true;

  // Strip meter fields from the payload returned to consumers so endpoint
  // types stay clean.
  const { creditsUsed: _u, creditsRemaining: _r, cached: _c, ...payload } = root;

  return {
    data: payload as T,
    creditsUsed,
    creditsRemaining,
    cached,
  };
}
