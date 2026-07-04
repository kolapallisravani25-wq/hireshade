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

// ── Deepgram transcription credentials ──────────────────────────────────────
// Mints a SHORT-LIVED, project-scoped Deepgram API key for the caller.
//
// Why this exists (two production failures it removes):
//  1. Previously the Deepgram key had to be baked into the Vite bundle at
//     build time (VITE_DEEPGRAM_API_KEY). Forget the env var at build → live
//     transcription silently produces nothing. Server-issued keys make the
//     browser build independent of build-time secrets.
//  2. A key baked into a public JS bundle is extractable by anyone, who can
//     then burn the Deepgram account balance. Minted keys expire on their own
//     (DEEPGRAM_TEMP_KEY_TTL_SECONDS, default 2 h) and are per-user.
//
// The minted key is a normal Deepgram key, so every existing consumer
// (browser ["token", key] subprotocol AND the Rust `Authorization: Token`
// header) works unchanged.

const DEEPGRAM_API_BASE = "https://api.deepgram.com/v1";
const DEEPGRAM_TEMP_KEY_TTL_SECONDS =
  Number(process.env["DEEPGRAM_TEMP_KEY_TTL_SECONDS"]) > 0
    ? Number(process.env["DEEPGRAM_TEMP_KEY_TTL_SECONDS"])
    : 7200;

let cachedProjectId: string | null =
  process.env["DEEPGRAM_PROJECT_ID"]?.trim() || null;

/** Per-user cache of minted keys so retry storms don't spam Deepgram. */
const mintedKeyCache = new Map<string, { key: string; expiresAt: number }>();

async function resolveDeepgramProjectId(masterKey: string): Promise<string> {
  if (cachedProjectId) return cachedProjectId;
  const res = await fetch(`${DEEPGRAM_API_BASE}/projects`, {
    headers: { Authorization: `Token ${masterKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Deepgram projects lookup failed (${res.status})`);
  }
  const json = (await res.json()) as {
    projects?: { project_id?: string }[];
  };
  const id = json.projects?.[0]?.project_id;
  if (!id) throw new Error("No Deepgram project found for this API key");
  cachedProjectId = id;
  return id;
}

router.post("/deepgram-token", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const masterKey = process.env["DEEPGRAM_API_KEY"]?.trim();
    if (!masterKey) {
      // Web has no build-time key fallback anymore (removing it kept the
      // master key out of the shipped bundle), so a 503 here means web
      // transcription is unavailable until DEEPGRAM_API_KEY is set on the
      // server. The desktop app has its own compiled-in key path.
      res.status(503).json({ error: "Deepgram is not configured on the server" });
      return;
    }

    const now = Date.now();
    const cached = mintedKeyCache.get(userId);
    if (cached && cached.expiresAt - now > 5 * 60_000) {
      res.json({
        key: cached.key,
        expiresAt: new Date(cached.expiresAt).toISOString(),
      });
      return;
    }

    const projectId = await resolveDeepgramProjectId(masterKey);
    const mintRes = await fetch(
      `${DEEPGRAM_API_BASE}/projects/${projectId}/keys`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${masterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          comment: `hireshade-session:${userId}`,
          scopes: ["usage:write"],
          time_to_live_in_seconds: DEEPGRAM_TEMP_KEY_TTL_SECONDS,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!mintRes.ok) {
      const text = await mintRes.text().catch(() => "");
      console.error("[auth] deepgram key mint failed", mintRes.status, text);
      res.status(502).json({ error: "Failed to mint transcription credentials" });
      return;
    }

    const minted = (await mintRes.json()) as { key?: string };
    if (!minted.key) {
      res.status(502).json({ error: "Deepgram returned no key" });
      return;
    }

    const expiresAt = now + DEEPGRAM_TEMP_KEY_TTL_SECONDS * 1000;
    mintedKeyCache.set(userId, { key: minted.key, expiresAt });
    // Opportunistic cache pruning.
    if (mintedKeyCache.size > 500) {
      for (const [k, v] of mintedKeyCache) {
        if (v.expiresAt <= now) mintedKeyCache.delete(k);
      }
    }

    res.json({ key: minted.key, expiresAt: new Date(expiresAt).toISOString() });
  } catch (err) {
    console.error("[auth] deepgram-token error", err);
    res.status(502).json({ error: "Failed to mint transcription credentials" });
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
