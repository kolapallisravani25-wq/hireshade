import { db } from "@workspace/db";
import { usersTable, creditsBalanceTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { SIGNUP_CREDITS } from "./signupGrant.js";

export async function findInternalUserId(clerkUserId: string): Promise<string | null> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function upsertUserByClerkId(clerkUserId: string): Promise<string> {
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0]!.id;
  }

  const newUserId = uuidv4();
  await db.insert(usersTable).values({
    id: newUserId,
    clerkUserId,
    email: `${clerkUserId}@unknown.local`,
  });

  await db.insert(creditsBalanceTable).values({
    id: uuidv4(),
    userId: newUserId,
    purchasedCredits: "0",
    earnedCredits: String(SIGNUP_CREDITS),
    heldCredits: "0",
  });

  return newUserId;
}
