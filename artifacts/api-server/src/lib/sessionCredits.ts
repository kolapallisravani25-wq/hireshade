import { db } from "@workspace/db";
import {
  sessionsTable,
  creditsBalanceTable,
  creditsUsageTable,
  type DbSession,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger.js";
import { SIGNUP_CREDITS } from "./signupGrant.js";

/**
 * Session metering constants. Env-overridable so pricing changes don't need a
 * redeploy of business logic — only of configuration.
 *
 *  - CREDITS_PER_MINUTE   default 0.5 (matches published pricing)
 *  - GRACE_ZONE_MINUTES   sessions ending within this window are free
 *  - FREE_SESSION_MINUTES hard cap for `free` sessions (mirrors client timer)
 */
function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export const CREDITS_PER_MINUTE = envNum("CREDITS_PER_MINUTE", 0.5);
export const GRACE_ZONE_MINUTES = envNum("GRACE_ZONE_MINUTES", 5);
export const FREE_SESSION_MINUTES = envNum("FREE_SESSION_MINUTES", 5);

/**
 * How long an ACTIVE session may go without a heartbeat (which bumps
 * `updatedAt` every 60 s) before it is considered abandoned and auto-settled.
 * 3 minutes = 3 missed heartbeats — tolerant of transient network loss but
 * short enough that a crashed client never blocks the user for long.
 */
export const STALE_ACTIVE_MS = envNum("STALE_ACTIVE_MS", 3 * 60_000);

export type TerminalStatus =
  | "COMPLETED"
  | "CREDIT_EXHAUSTED"
  | "AUTO_ENDED"
  | "FORCE_ENDED"
  | "ABANDONED";

const TERMINAL_STATUSES: readonly string[] = [
  "COMPLETED",
  "CREDIT_EXHAUSTED",
  "AUTO_ENDED",
  "FORCE_ENDED",
  "ABANDONED",
];

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Whole billable minutes between start and end (ceil, min 0). */
export function elapsedMinutes(startedAt: Date | null, endedAt: Date): number {
  if (!startedAt) return 0;
  const ms = endedAt.getTime() - startedAt.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

export interface AvailableCredits {
  purchased: number;
  earned: number;
  held: number;
  total: number;
}

export async function getAvailableCredits(
  userId: string,
): Promise<AvailableCredits> {
  const [row] = await db
    .select()
    .from(creditsBalanceTable)
    .where(eq(creditsBalanceTable.userId, userId))
    .limit(1);
  if (!row) {
    // requireAuth seeds a balance row on first login; a missing row means a
    // legacy user — treat as the default signup grant.
    return {
      purchased: 0,
      earned: SIGNUP_CREDITS,
      held: 0,
      total: SIGNUP_CREDITS,
    };
  }
  const purchased = parseFloat(row.purchasedCredits) || 0;
  const earned = parseFloat(row.earnedCredits) || 0;
  const held = parseFloat(row.heldCredits) || 0;
  return {
    purchased,
    earned,
    held,
    total: Math.max(0, purchased + earned - held),
  };
}

export interface SettleResult {
  status: TerminalStatus;
  minutes: number;
  creditsDeducted: string;
  deductionReason: string;
}

/**
 * Terminal settlement of a session: computes duration, deducts session-minute
 * credits (earned first, then purchased), writes the ledger row, and moves the
 * session to a terminal status — all in one transaction.
 *
 * IDEMPOTENT: the UPDATE is conditional on the session still being in a
 * non-terminal status; if a concurrent settle won, we return the stored
 * outcome and never double-charge. Safe to call from deactivate, heartbeat
 * exhaustion, and the stale-session reaper simultaneously.
 */
export async function settleSession(opts: {
  session: DbSession;
  endedAt?: Date;
  /** Terminal status to apply when settlement succeeds normally. */
  reason: "COMPLETED" | "AUTO_ENDED" | "FORCE_ENDED";
  aiUsage?: number | null;
}): Promise<SettleResult> {
  const endedAt = opts.endedAt ?? new Date();
  const { session } = opts;

  // Fast path: already terminal → return stored outcome, charge nothing.
  if (isTerminalStatus(session.status)) {
    return {
      status: session.status as TerminalStatus,
      minutes: elapsedMinutes(session.startedAt, session.endedAt ?? endedAt),
      creditsDeducted: session.creditsDeducted ?? "0",
      deductionReason: session.deductionReason ?? "ALREADY_SETTLED",
    };
  }

  const minutes = elapsedMinutes(session.startedAt, endedAt);

  // Determine the charge.
  let cost = 0;
  let deductionReason: string;
  if (session.free) {
    deductionReason = "FREE_SESSION";
  } else if (minutes <= GRACE_ZONE_MINUTES) {
    deductionReason = "FREE_ZONE";
  } else {
    cost = round2(minutes * CREDITS_PER_MINUTE);
    deductionReason = "SESSION_MINUTES";
  }

  return db.transaction(async (tx) => {
    // Claim the session row: only ONE caller can transition it out of a
    // non-terminal status. `returning` tells us whether we won the race.
    const claimed = await tx
      .update(sessionsTable)
      .set({
        status: "COMPLETING",
        updatedAt: new Date(),
      })
      .where(
        sql`${sessionsTable.id} = ${session.id} AND ${sessionsTable.status} IN ('ACTIVE', 'PRE_CHECK', 'COMPLETING')`,
      )
      .returning({ id: sessionsTable.id });

    if (claimed.length === 0) {
      // Lost the race — re-read and return the winner's outcome.
      const [current] = await tx
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, session.id))
        .limit(1);
      return {
        status: (current?.status ?? "COMPLETED") as TerminalStatus,
        minutes,
        creditsDeducted: current?.creditsDeducted ?? "0",
        deductionReason: current?.deductionReason ?? "ALREADY_SETTLED",
      };
    }

    let finalStatus: TerminalStatus = opts.reason;
    let charged = 0;

    if (cost > 0) {
      // Lock the balance row for the deduction.
      const [balance] = await tx
        .select()
        .from(creditsBalanceTable)
        .where(eq(creditsBalanceTable.userId, session.userId))
        .for("update")
        .limit(1);

      if (balance) {
        let earned = parseFloat(balance.earnedCredits) || 0;
        let purchased = parseFloat(balance.purchasedCredits) || 0;
        const available = Math.max(0, earned + purchased);

        charged = Math.min(cost, available);
        if (charged < cost) {
          finalStatus = "CREDIT_EXHAUSTED";
          deductionReason = "SESSION_MINUTES_PARTIAL";
        }

        // Spend earned credits first, then purchased.
        const fromEarned = Math.min(earned, charged);
        earned = round2(earned - fromEarned);
        purchased = round2(purchased - (charged - fromEarned));

        await tx
          .update(creditsBalanceTable)
          .set({
            earnedCredits: String(earned),
            purchasedCredits: String(purchased),
            updatedAt: new Date(),
          })
          .where(eq(creditsBalanceTable.userId, session.userId));
      } else {
        // Legacy user without a balance row: seed one reflecting the spend
        // against the default 100-credit signup grant.
        const grant = SIGNUP_CREDITS;
        charged = Math.min(cost, grant);
        if (charged < cost) {
          finalStatus = "CREDIT_EXHAUSTED";
          deductionReason = "SESSION_MINUTES_PARTIAL";
        }
        await tx.insert(creditsBalanceTable).values({
          id: uuidv4(),
          userId: session.userId,
          purchasedCredits: "0",
          earnedCredits: String(round2(grant - charged)),
          heldCredits: "0",
          updatedAt: new Date(),
        });
      }

      if (charged > 0) {
        await tx.insert(creditsUsageTable).values({
          id: uuidv4(),
          userId: session.userId,
          operation: "session_minutes",
          creditsUsed: String(round2(charged)),
          sessionId: session.id,
          aiModel: session.aiModel,
          metadata: {
            minutes,
            ratePerMinute: CREDITS_PER_MINUTE,
            graceZoneMinutes: GRACE_ZONE_MINUTES,
            settledBy: opts.reason,
          },
          createdAt: new Date(),
        });
      }
    }

    await tx
      .update(sessionsTable)
      .set({
        status: finalStatus,
        endedAt,
        creditsDeducted: String(round2(charged)),
        deductionReason,
        ...(typeof opts.aiUsage === "number" && Number.isFinite(opts.aiUsage)
          ? { aiUsage: Math.max(0, Math.floor(opts.aiUsage)) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(sessionsTable.id, session.id));

    logger.info(
      {
        sessionId: session.id,
        userId: session.userId,
        minutes,
        charged,
        finalStatus,
        deductionReason,
      },
      "[credits] session settled",
    );

    return {
      status: finalStatus,
      minutes,
      creditsDeducted: String(round2(charged)),
      deductionReason,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
