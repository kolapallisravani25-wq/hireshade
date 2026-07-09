import { Router, type IRouter } from "express";
import { logger } from "../lib/logger.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import { desktopSessionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  isDesktopAuthConfigured,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signDesktopAccessToken,
  DESKTOP_ACCESS_TTL_SECONDS,
} from "../lib/desktopAuth.js";

/**
 * Desktop release distribution — proxies the PRIVATE GitHub repo's releases.
 *
 * Why this exists: the Dashboard download buttons and the Tauri auto-updater
 * both pointed at github.com/<owner>/<repo>/releases/latest/download/… — but
 * the repo is PRIVATE, so every one of those URLs is a 404 for users'
 * browsers and for the shipped desktop app. Making the product source public
 * is not an option; the standard pattern is this: the backend talks to the
 * GitHub API with a server-side token and the public surface is our own
 * domain.
 *
 * Endpoints (deliberately UNAUTHENTICATED — installer downloads and update
 * checks happen outside any signed-in context):
 *
 *   GET /api/desktop/latest
 *     Normalized manifest. Superset of the Tauri updater format
 *     (version / notes / pub_date / platforms{target:{url,signature}})
 *     plus a `downloads` map the web DownloadApp component renders.
 *     All URLs point back at /api/desktop/download/<asset> on this host.
 *
 *   GET /api/desktop/download/:asset
 *     302 to a short-lived signed URL for that asset (GitHub returns one
 *     when an asset is requested with Accept: application/octet-stream).
 *     :asset must exactly match an asset name on the latest release —
 *     nothing else is fetchable.
 *
 * Config: GITHUB_RELEASES_TOKEN — fine-grained PAT, Contents:read on the
 * repo. Fail-closed 503 when unset. Release metadata (and the tiny .sig
 * files the updater needs inlined) are cached in-memory for 5 minutes to
 * stay far from GitHub rate limits.
 */

const GITHUB_REPO = process.env["DESKTOP_RELEASES_REPO"] ?? "kolapallisravani25-wq/hireshade";
const CACHE_TTL_MS = 5 * 60_000;

interface GhAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
}
interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  assets: GhAsset[];
}

interface CachedRelease {
  fetchedAt: number;
  release: GhRelease | null; // null = repo has no releases yet
  signatures: Record<string, string>; // asset name (.sig) → contents
}

let cache: CachedRelease | null = null;

function githubToken(): string | undefined {
  return process.env["GITHUB_RELEASES_TOKEN"]?.trim() || undefined;
}

async function ghApi(path: string, accept = "application/vnd.github+json"): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${githubToken()}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
}

async function loadLatestRelease(): Promise<CachedRelease> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;

  const res = await ghApi(`/repos/${GITHUB_REPO}/releases/latest`);
  if (res.status === 404) {
    cache = { fetchedAt: now, release: null, signatures: {} };
    return cache;
  }
  if (!res.ok) {
    // Keep serving a previous good cache through transient GitHub errors.
    if (cache) return cache;
    throw new Error(`GitHub releases API ${res.status}`);
  }
  const release = (await res.json()) as GhRelease;

  // Inline the updater signature files (tiny text assets) so the manifest is
  // self-contained for the Tauri updater.
  const signatures: Record<string, string> = {};
  for (const asset of release.assets) {
    if (!asset.name.endsWith(".sig")) continue;
    try {
      const sigRes = await ghApi(
        `/repos/${GITHUB_REPO}/releases/assets/${asset.id}`,
        "application/octet-stream",
      );
      if (sigRes.status >= 300 && sigRes.status < 400) {
        const loc = sigRes.headers.get("location");
        if (loc) {
          const body = await fetch(loc, { signal: AbortSignal.timeout(10_000) });
          if (body.ok) signatures[asset.name] = (await body.text()).trim();
        }
      } else if (sigRes.ok) {
        signatures[asset.name] = (await sigRes.text()).trim();
      }
    } catch (err) {
      logger.warn({ asset: asset.name, err }, "[desktop] failed to inline signature");
    }
  }

  cache = { fetchedAt: now, release, signatures };
  return cache;
}

function publicBase(): string {
  return process.env["PUBLIC_BACKEND_URL"] ?? "";
}

function proxyUrl(assetName: string): string {
  return `${publicBase()}/api/desktop/download/${encodeURIComponent(assetName)}`;
}

/** Map release assets into updater `platforms` + web `downloads` shapes. */
function buildManifest(release: GhRelease, signatures: Record<string, string>) {
  const platforms: Record<string, { url: string; signature?: string }> = {};
  const downloads: {
    mac?: { dmg?: { url: string }; appTarGz?: { url: string } };
    windows?: { exe?: { url: string }; msi?: { url: string } };
    linux?: { appImage?: { url: string }; deb?: { url: string }; rpm?: { url: string } };
  } = {};

  const sigFor = (assetName: string) => signatures[`${assetName}.sig`];

  for (const asset of release.assets) {
    const n = asset.name;
    const lower = n.toLowerCase();
    const url = proxyUrl(n);

    if (lower.endsWith(".sig")) continue;

    if (lower.endsWith(".dmg")) {
      downloads.mac = { ...downloads.mac, dmg: { url } };
    } else if (lower.endsWith(".app.tar.gz")) {
      downloads.mac = { ...downloads.mac, appTarGz: { url } };
      // Tauri updater targets for macOS
      for (const target of ["darwin-x86_64", "darwin-aarch64"]) {
        if (lower.includes("aarch64") && target !== "darwin-aarch64") continue;
        if (lower.includes("x64") && target !== "darwin-x86_64") continue;
        platforms[target] = { url, signature: sigFor(n) };
      }
    } else if (lower.endsWith(".msi")) {
      downloads.windows = { ...downloads.windows, msi: { url } };
      platforms["windows-x86_64"] = platforms["windows-x86_64"] ?? { url, signature: sigFor(n) };
    } else if (lower.endsWith(".exe")) {
      downloads.windows = { ...downloads.windows, exe: { url } };
      // NSIS installer is Tauri's preferred windows updater artifact when present.
      platforms["windows-x86_64"] = { url, signature: sigFor(n) };
    } else if (lower.endsWith(".appimage")) {
      downloads.linux = { ...downloads.linux, appImage: { url } };
      platforms["linux-x86_64"] = { url, signature: sigFor(n) };
    } else if (lower.endsWith(".deb")) {
      downloads.linux = { ...downloads.linux, deb: { url } };
    } else if (lower.endsWith(".rpm")) {
      downloads.linux = { ...downloads.linux, rpm: { url } };
    }
  }

  return {
    version: release.tag_name.replace(/^v/, ""),
    notes: release.body ?? release.name ?? "",
    pub_date: release.published_at ?? undefined,
    platforms,
    downloads,
  };
}

const router: IRouter = Router();

router.get("/latest", async (_req, res) => {
  try {
    if (!githubToken()) {
      res.status(503).json({ error: "Desktop releases are not configured" });
      return;
    }
    const { release, signatures } = await loadLatestRelease();
    if (!release) {
      res.status(404).json({ error: "NO_RELEASE", message: "No desktop build has been published yet" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(buildManifest(release, signatures));
  } catch (err) {
    logger.error({ err }, "[desktop] latest manifest error");
    res.status(502).json({ error: "Failed to load release information" });
  }
});

router.get("/download/:asset", async (req, res) => {
  try {
    if (!githubToken()) {
      res.status(503).json({ error: "Desktop releases are not configured" });
      return;
    }
    const assetName = String(req.params["asset"] ?? "");
    const { release } = await loadLatestRelease();
    const asset = release?.assets.find((a) => a.name === assetName);
    if (!asset) {
      res.status(404).json({ error: "Asset not found on the latest release" });
      return;
    }

    const ghRes = await ghApi(
      `/repos/${GITHUB_REPO}/releases/assets/${asset.id}`,
      "application/octet-stream",
    );
    const location = ghRes.headers.get("location");
    if ((ghRes.status === 302 || ghRes.status === 307) && location) {
      // GitHub hands back a short-lived signed URL — send the browser there.
      res.redirect(302, location);
      return;
    }
    logger.error({ status: ghRes.status, assetName }, "[desktop] asset redirect missing");
    res.status(502).json({ error: "Failed to prepare download" });
  } catch (err) {
    logger.error({ err }, "[desktop] download error");
    res.status(502).json({ error: "Failed to prepare download" });
  }
});

// ── Desktop auth (external-browser session) ─────────────────────────────────
//
// Flow: the desktop opens the system browser to the web /desktop-auth page; the
// user signs in there with production Clerk (works — it's the website); that page
// (authenticated by the Clerk web session) calls POST /link to mint a refresh
// token, and hands it back to the app via a loopback/deep-link. The app stores it
// in the OS keychain and calls POST /token to get short-lived access tokens for
// API calls. No Clerk runs inside the webview, so the session survives launches.

/**
 * POST /api/desktop/link  (Clerk web session required)
 * Mints a desktop refresh token for the signed-in user and returns it ONCE,
 * plus a first access token.
 */
router.post("/link", requireAuth, async (req, res) => {
  try {
    if (!isDesktopAuthConfigured()) {
      res.status(500).json({ error: "Desktop auth is not configured on the server" });
      return;
    }
    const clerkUserId = req.auth!.sub;

    const refreshToken = generateRefreshToken();
    const label =
      typeof req.body?.label === "string" && req.body.label.trim()
        ? req.body.label.trim().slice(0, 120)
        : "desktop";

    await db.insert(desktopSessionsTable).values({
      id: uuidv4(),
      clerkUserId,
      tokenHash: hashRefreshToken(refreshToken),
      label,
      expiresAt: refreshTokenExpiry(),
    });

    const accessToken = await signDesktopAccessToken(clerkUserId);
    res.json({
      refreshToken,
      accessToken,
      expiresInSeconds: DESKTOP_ACCESS_TTL_SECONDS,
    });
  } catch (err) {
    logger.error({ err }, "[desktop] link failed");
    res.status(500).json({ error: "Failed to link desktop session" });
  }
});

/**
 * POST /api/desktop/token  (no Clerk session — uses the refresh token)
 * Exchanges a stored refresh token for a fresh short-lived access token.
 */
router.post("/token", async (req, res) => {
  try {
    if (!isDesktopAuthConfigured()) {
      res.status(500).json({ error: "Desktop auth is not configured on the server" });
      return;
    }
    const refreshToken =
      typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";
    if (!refreshToken) {
      res.status(400).json({ error: "Missing refreshToken" });
      return;
    }

    const rows = await db
      .select()
      .from(desktopSessionsTable)
      .where(eq(desktopSessionsTable.tokenHash, hashRefreshToken(refreshToken)))
      .limit(1);
    const row = rows[0];

    if (!row || row.revoked || row.expiresAt.getTime() < Date.now()) {
      res.status(401).json({ error: "Desktop session is invalid, revoked, or expired" });
      return;
    }

    await db
      .update(desktopSessionsTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(desktopSessionsTable.id, row.id));

    const accessToken = await signDesktopAccessToken(row.clerkUserId);
    res.json({ accessToken, expiresInSeconds: DESKTOP_ACCESS_TTL_SECONDS });
  } catch (err) {
    logger.error({ err }, "[desktop] token exchange failed");
    res.status(500).json({ error: "Failed to refresh desktop token" });
  }
});

/**
 * POST /api/desktop/logout  (revoke a refresh token; safe to call unauthenticated)
 */
router.post("/logout", async (req, res) => {
  try {
    const refreshToken =
      typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";
    if (refreshToken) {
      await db
        .update(desktopSessionsTable)
        .set({ revoked: true })
        .where(eq(desktopSessionsTable.tokenHash, hashRefreshToken(refreshToken)));
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[desktop] logout failed");
    res.status(500).json({ error: "Failed to revoke desktop session" });
  }
});

export default router;
