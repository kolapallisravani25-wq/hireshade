import { db } from "@workspace/db";
import { creditsBalanceTable, creditsUsageTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger.js";

/**
 * Per-feature (per-action) credit costs. These are DISTINCT from session
 * per-minute billing: they cover one-shot AI actions OUTSIDE a live session
 * (resume/project generation, ATS scoring, etc.). In-session AI answers and
 * screen analysis are NOT charged here — they're covered by the session's
 * per-minute meter (see sessionCredits.ts) and charging both would double-bill.
 *
 * Env-overridable via FEATURE_COST_<OPERATION> (e.g. FEATURE_COST_RESUME_GENERATE=8).
 */
const DEFAULT_FEATURE_COSTS: Record<string, number> = {
  // Founder-declared prices (from the original credits FEATURE_COSTS map).
  resume_ats: 5,
  resume_cover_letter: 8,
  resume_generate: 10,
  resume_enhance_section: 3,
  project_generate: 10,
  // Not yet priced by the product — free until set via FEATURE_COST_* env.
  // Listed explicitly so /feature-costs advertises them and the meter
  // contract is uniform across every credited endpoint.
  resume_extract_fields: 0,
  resume_rewrite: 0,
  resume_tailor: 0,
  resume_inject_skills: 0,
  resume_inject_keywords: 0,
  resume_analyze_keywords: 0,
  // Defined but not yet wired to any UI surface (see endpoints.ts
  // projectsEditComponent) — registered now so it can't silently go unmetered
  // the moment a future UI wires it up.
  project_edit_component: 0,
  // "Assistant" chat (chat with your interview history, outside any live
  // session) — was previously invisible to the credit system entirely: no
  // charge, no usage row, no tracking of any kind despite calling OpenRouter
  // on every message. Registered at 0 by default (no surprise price change
  // for existing users) so usage is now at least tracked in credits_usage;
  // set FEATURE_COST_ASSISTANT_CHAT to price it.
  assistant_chat: 0,
  ai_project_generation: 0,
};

export function featureCost(operation: string): number {
  const envKey = `FEATURE_COST_${operation.toUpperCase()}`;
  const override = Number(process.env[envKey]);
  if (Number.isFinite(override) && override >= 0) return override;
  return DEFAULT_FEATURE_COSTS[operation] ?? 0;
}

export function allFeatureCosts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const op of Object.keys(DEFAULT_FEATURE_COSTS)) out[op] = featureCost(op);
  return out;
}

export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}

export interface ChargeResult {
  creditsUsed: number;
  creditsRemaining: number;
  cached: boolean;
}

function totalOf(row: typeof creditsBalanceTable.$inferSelect | undefined): number {
  if (!row) return 0;
  return Math.max(
    0,
    (parseFloat(row.purchasedCredits) || 0) +
      (parseFloat(row.earnedCredits) || 0) -
      (parseFloat(row.heldCredits) || 0),
  );
}

/**
 * Charge a user for one feature action, idempotently.
 *
 *  - Zero-cost operations short-circuit (no row written, always allowed).
 *  - If `idempotencyKey` was already charged, the ORIGINAL result is returned
 *    with cached:true — duplicate clicks / retries never double-bill.
 *  - Spends earned credits first, then purchased.
 *  - Throws InsufficientCreditsError (→ 402) when the balance can't cover it,
 *    charging nothing.
 *
 * Returns the exact { creditsUsed, creditsRemaining, cached } shape the client
 * helper `postCreditedAi` expects.
 */
export async function chargeFeature(opts: {
  userId: string;
  operation: string;
  idempotencyKey?: string | null;
  resumeId?: string | null;
  aiModel?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<ChargeResult> {
  const cost = featureCost(opts.operation);

  // Free operation: no charge, report current balance.
  if (cost <= 0) {
    const [bal] = await db
      .select()
      .from(creditsBalanceTable)
      .where(eq(creditsBalanceTable.userId, opts.userId))
      .limit(1);
    return { creditsUsed: 0, creditsRemaining: totalOf(bal), cached: false };
  }

  // Idempotency replay: return the original charge, don't re-bill.
  if (opts.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(creditsUsageTable)
      .where(eq(creditsUsageTable.idempotencyKey, opts.idempotencyKey))
      .limit(1);
    if (existing) {
      const [bal] = await db
        .select()
        .from(creditsBalanceTable)
        .where(eq(creditsBalanceTable.userId, opts.userId))
        .limit(1);
      return {
        creditsUsed: parseFloat(existing.creditsUsed) || 0,
        creditsRemaining: totalOf(bal),
        cached: true,
      };
    }
  }

  return db.transaction(async (tx) => {
    // Claim the idempotency key FIRST. The unique index makes this the single
    // serialization point: exactly one concurrent caller wins the insert; the
    // rest hit a unique violation and return the winner's cached result — and
    // crucially, the losers never touch the balance, so there's no
    // deduct-then-rollback race. If the balance later can't cover the cost we
    // throw, and the whole transaction (including this row) rolls back.
    const usageId = uuidv4();
    try {
      await tx.insert(creditsUsageTable).values({
        id: usageId,
        userId: opts.userId,
        operation: opts.operation,
        creditsUsed: String(cost),
        idempotencyKey: opts.idempotencyKey ?? null,
        resumeId: opts.resumeId ?? null,
        aiModel: opts.aiModel ?? null,
        metadata: opts.metadata ?? null,
        createdAt: new Date(),
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err) && opts.idempotencyKey) {
        throw new IdempotencyRace(opts.idempotencyKey);
      }
      throw err;
    }

    const [balance] = await tx
      .select()
      .from(creditsBalanceTable)
      .where(eq(creditsBalanceTable.userId, opts.userId))
      .for("update")
      .limit(1);

    let earned = parseFloat(balance?.earnedCredits ?? "0") || 0;
    let purchased = parseFloat(balance?.purchasedCredits ?? "0") || 0;
    const held = parseFloat(balance?.heldCredits ?? "0") || 0;

    // Legacy users with no balance row get the default 100-credit grant.
    if (!balance) {
      earned = 100;
    }

    const available = Math.max(0, earned + purchased - held);
    if (available < cost) {
      throw new InsufficientCreditsError(cost, available);
    }

    const fromEarned = Math.min(earned, cost);
    earned = round2(earned - fromEarned);
    purchased = round2(purchased - (cost - fromEarned));

    if (balance) {
      await tx
        .update(creditsBalanceTable)
        .set({
          earnedCredits: String(earned),
          purchasedCredits: String(purchased),
          updatedAt: new Date(),
        })
        .where(eq(creditsBalanceTable.userId, opts.userId));
    } else {
      await tx.insert(creditsBalanceTable).values({
        id: uuidv4(),
        userId: opts.userId,
        purchasedCredits: "0",
        earnedCredits: String(earned),
        heldCredits: "0",
        updatedAt: new Date(),
      });
    }

    logger.info(
      { userId: opts.userId, operation: opts.operation, cost },
      "[credits] feature charged",
    );

    return {
      creditsUsed: cost,
      creditsRemaining: round2(Math.max(0, earned + purchased - held)),
      cached: false,
    };
  }).catch(async (err) => {
    if (err instanceof IdempotencyRace) {
      const [existing] = await db
        .select()
        .from(creditsUsageTable)
        .where(eq(creditsUsageTable.idempotencyKey, err.key))
        .limit(1);
      const [bal] = await db
        .select()
        .from(creditsBalanceTable)
        .where(eq(creditsBalanceTable.userId, opts.userId))
        .limit(1);
      return {
        creditsUsed: parseFloat(existing?.creditsUsed ?? String(cost)) || cost,
        creditsRemaining: totalOf(bal),
        cached: true,
      };
    }
    throw err;
  });
}

class IdempotencyRace extends Error {
  constructor(public readonly key: string) {
    super("idempotency race");
  }
}

/**
 * Express helper: charge for a feature and, on insufficient balance, write the
 * 402 the client's `postCreditedAi` maps to InsufficientCreditsError. Returns
 * the meter object to spread into the response `data` on success, or null when
 * a 402 was already sent (caller must return immediately).
 */
export async function chargeOr402(
  res: {
    status: (code: number) => { json: (body: unknown) => void };
  },
  opts: Parameters<typeof chargeFeature>[0],
): Promise<ChargeResult | null> {
  try {
    return await chargeFeature(opts);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      res.status(402).json({
        error: "INSUFFICIENT_CREDITS",
        message: "Insufficient credits",
        required: err.required,
        available: err.available,
      });
      return null;
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres unique-violation is SQLSTATE 23505. Drizzle wraps the driver
  // error, so the code can be on the error itself OR on its .cause.
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (
      typeof cur === "object" &&
      cur !== null &&
      "code" in cur &&
      (cur as { code?: string }).code === "23505"
    ) {
      return true;
    }
    cur =
      typeof cur === "object" && cur !== null && "cause" in cur
        ? (cur as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
