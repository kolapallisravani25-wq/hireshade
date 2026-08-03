const buckets = new Map<string, { startedAt: number; count: number }>();

const configuredLimit = Number(process.env["AI_ACTIONS_PER_MINUTE"] ?? "20");
export const AI_ACTIONS_PER_MINUTE =
  Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.floor(configuredLimit) : 20;

export class AiRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("AI request rate limit exceeded");
    this.name = "AiRateLimitError";
  }
}

export function enforceAiRateLimit(
  key: string,
  now = Date.now(),
  limit = AI_ACTIONS_PER_MINUTE,
  windowMs = 60_000,
): void {
  const current = buckets.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    buckets.set(key, { startedAt: now, count: 1 });
    return;
  }
  if (current.count >= limit) {
    throw new AiRateLimitError(Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000)));
  }
  current.count += 1;

  // ponytail: process-local limiter; replace with a shared store when the API scales horizontally.
  if (buckets.size > 5_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(bucketKey);
    }
  }
}

export function rateLimitAiOr429(
  res: {
    setHeader?: (name: string, value: string) => void;
    status: (code: number) => { json: (body: unknown) => void };
  },
  userId: string,
  scope: string,
): boolean {
  try {
    enforceAiRateLimit(`${userId}:${scope}`);
    return true;
  } catch (err) {
    if (!(err instanceof AiRateLimitError)) throw err;
    res.setHeader?.("Retry-After", String(err.retryAfterSeconds));
    res.status(429).json({
      error: "RATE_LIMITED",
      message: "Too many AI requests; please retry shortly",
      retryAfterSeconds: err.retryAfterSeconds,
    });
    return false;
  }
}
