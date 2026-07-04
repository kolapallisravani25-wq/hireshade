import type { Request, Response, NextFunction } from "express";
import { verifyClerkToken, type ClerkTokenPayload } from "../lib/clerkAuth.js";
import { db } from "@workspace/db";
import {
  usersTable,
  creditsBalanceTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { SIGNUP_CREDITS } from "../lib/signupGrant.js";

declare global {
  namespace Express {
    interface Request {
      auth?: ClerkTokenPayload;
      userId?: string;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyClerkToken(token);
    req.auth = payload;

    const clerkUserId = payload.sub;

    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);

    if (existing.length > 0) {
      req.userId = existing[0]!.id;
    } else {
      const newUserId = uuidv4();
      const email =
        (payload["email"] as string | undefined) ||
        (payload["email_address"] as string | undefined) ||
        `${clerkUserId}@unknown.local`;

      await db.insert(usersTable).values({
        id: newUserId,
        clerkUserId,
        email,
        firstName: (payload["first_name"] as string | undefined) ?? null,
        lastName: (payload["last_name"] as string | undefined) ?? null,
        imageUrl: (payload["image_url"] as string | undefined) ?? null,
      });

      await db.insert(creditsBalanceTable).values({
        id: uuidv4(),
        userId: newUserId,
        purchasedCredits: "0",
        earnedCredits: String(SIGNUP_CREDITS),
        heldCredits: "0",
      });

      req.userId = newUserId;
    }

    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
