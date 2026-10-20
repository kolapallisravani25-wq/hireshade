/**
 * Ordered, timeout-bounded LLM failover router (G-017).
 *
 * Behaviour:
 *   - providers are tried in the order supplied; unconfigured ones are skipped
 *     (so a missing OPENROUTER_API_KEY never surfaces as a fake answer);
 *   - each attempt is bounded by `timeoutMs` via AbortSignal;
 *   - failover happens ONLY before the first delta. Once tokens have reached the
 *     caller we cannot transparently restart without duplicating text, so the
 *     error is rethrown for the route to render an in-card error;
 *   - the router never falls back to a mock provider in real mode.
 */
import type { LlmProvider, LlmProviderAttempt, LlmRouterResult, LlmStreamRequest } from "./types.js";

export interface LlmRouterOptions {
  providers: LlmProvider[];
  timeoutMs?: number;
  clock?: () => number;
}

export interface LlmRouter {
  stream(req: LlmStreamRequest, onDelta: (delta: string) => void): Promise<LlmRouterResult>;
}

export const DEFAULT_LLM_TIMEOUT_MS = 60_000;

export function createLlmRouter(opts: LlmRouterOptions): LlmRouter {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const clock = opts.clock ?? (() => performance.now());

  return {
    async stream(req, onDelta): Promise<LlmRouterResult> {
      const candidates = opts.providers.filter((p) => p.isConfigured());
      if (!candidates.length) {
        throw new Error(
          "No LLM provider is configured. Set OPENROUTER_API_KEY, or enable DEMO_MODE=1 for the keyless demo.",
        );
      }
      const attempts: LlmProviderAttempt[] = [];
      const startedAt = clock();
      const failures: string[] = [];

      for (const provider of candidates) {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = req.signal
          ? AbortSignal.any([req.signal, timeoutSignal])
          : timeoutSignal;
        let emitted = false;
        let firstTokenAt: number | null = null;
        const wrappedOnDelta = (delta: string) => {
          if (!emitted) {
            emitted = true;
            firstTokenAt = clock();
          }
          onDelta(delta);
        };

        try {
          const text = await provider.stream({ ...req, signal }, wrappedOnDelta);
          attempts.push({ providerId: provider.id, ok: true, emitted });
          return {
            providerId: provider.id,
            text,
            attempts,
            failovers: attempts.length - 1,
            firstTokenLatencyMs:
              firstTokenAt !== null ? firstTokenAt - startedAt : clock() - startedAt,
          };
        } catch (err) {
          const isTimeout = timeoutSignal.aborted && !req.signal?.aborted;
          const category = isTimeout ? "timeout" : errorName(err);
          const message = isTimeout
            ? `timed out after ${timeoutMs}ms`
            : err instanceof Error
              ? err.message
              : String(err);
          attempts.push({
            providerId: provider.id,
            ok: false,
            emitted,
            error: `${category}: ${message}`,
          });
          failures.push(`${provider.id} (${category})`);
          if (emitted) {
            throw new Error(
              `LLM stream failed mid-answer via ${provider.id}: ${message}. Refusing to fail over after tokens were emitted.`,
            );
          }
        }
      }

      throw new Error(`All LLM providers failed: ${failures.join(", ")}`);
    },
  };
}

function errorName(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  return "error";
}
