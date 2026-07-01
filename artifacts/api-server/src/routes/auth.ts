import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const users = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!users.length) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = users[0]!;
    res.json({
      id: user.id,
      clerkUserId: user.clerkUserId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
      createdAt: user.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Desktop app hand-off ────────────────────────────────────────────────────
// The desktop widget opens the system browser to sign in (Clerk has no
// supported flow for signing in directly inside a Tauri webview). Once signed
// in, the browser calls this endpoint to mint a short-lived Clerk "sign-in
// token" (ticket), then redirects to the widget's local callback server with
// it. The widget completes sign-in via `clerkSignIn.create({ strategy:
// "ticket", ticket })` — see AuthScreen.tsx.
router.post("/tauri-ticket", requireAuth, async (req, res) => {
  try {
    const clerkUserId = req.auth!.sub;
    const secretKey = process.env["CLERK_SECRET_KEY"];
    if (!secretKey) {
      res.status(500).json({ error: "Clerk secret key not configured" });
      return;
    }

    const clerkRes = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: clerkUserId, expires_in_seconds: 60 }),
    });

    if (!clerkRes.ok) {
      const body = await clerkRes.text().catch(() => "");
      console.error("[auth] sign_in_tokens error", clerkRes.status, body);
      res.status(502).json({ error: "Failed to create sign-in ticket" });
      return;
    }

    const data = (await clerkRes.json()) as { token?: string };
    if (!data.token) {
      res.status(502).json({ error: "Clerk did not return a token" });
      return;
    }

    res.json({ ticket: data.token });
  } catch (err) {
    console.error("[auth] tauri-ticket error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
