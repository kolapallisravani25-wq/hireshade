import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// Local-disk storage: files live under `uploads/resumes/` and are served by
// the `/uploads` mount in app.ts — which verifies the HMAC signature +
// expiry produced here before serving anything (see verifyUploadsSignature).
const UPLOADS_ROOT = path.join(process.cwd(), "uploads", "resumes");

function publicBaseUrl(): string {
  return process.env["PUBLIC_BACKEND_URL"] ?? "";
}

/**
 * Signing secret for /uploads URLs. Env-overridable for multi-instance
 * deployments; defaults to a per-boot random secret, which needs zero
 * configuration and simply invalidates outstanding links on restart —
 * harmless at a 15-minute TTL (the client re-requests a fresh link on 403).
 */
const UPLOADS_SIGNING_SECRET =
  process.env["UPLOADS_SIGNING_SECRET"] || crypto.randomBytes(32).toString("hex");

function signUploadPath(relUploadPath: string, exp: number): string {
  return crypto
    .createHmac("sha256", UPLOADS_SIGNING_SECRET)
    .update(`${relUploadPath}|${exp}`)
    .digest("hex");
}

/**
 * Verify a signed /uploads request. `relUploadPath` is the path RELATIVE to
 * the /uploads mount, without a leading slash (e.g. "resumes/<uid>/<file>").
 */
export function verifyUploadsSignature(
  relUploadPath: string,
  expRaw: unknown,
  sigRaw: unknown,
): boolean {
  const exp = Number(expRaw);
  const sig = typeof sigRaw === "string" ? sigRaw : "";
  if (!Number.isFinite(exp) || exp * 1000 < Date.now() || !sig) return false;
  const expected = signUploadPath(relUploadPath, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Build the storage object path for a resume: `${userId}/${ts}_${safeName}`. */
export function buildResumeObjectPath(userId: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  return `${userId}/${Date.now()}_${safeName}`;
}

/** Save a resume file buffer to local disk under uploads/resumes/<relPath>. */
export async function uploadResumeObject(
  relPath: string,
  buffer: Buffer,
  _contentType: string,
): Promise<void> {
  const fullPath = path.join(UPLOADS_ROOT, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
}

/**
 * Returns a genuinely signed, expiring URL for viewing/downloading a resume.
 * Previously "signed" in name only: it returned a bare, never-expiring
 * /uploads path served by an UNAUTHENTICATED static mount — resume PII
 * protected by nothing but filename unguessability, leaking through browser
 * history, proxies, access logs, and Referer headers, forever.
 */
export async function getResumeSignedUrl(relPath: string, ttlSec = 900): Promise<string> {
  const relUploadPath = `resumes/${relPath}`;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = signUploadPath(relUploadPath, exp);
  return `${publicBaseUrl()}/uploads/${relUploadPath}?exp=${exp}&sig=${sig}`;
}

/** Reads a resume file straight off local disk (for server-side text extraction). */
export async function readResumeObject(relPath: string): Promise<Buffer> {
  const fullPath = path.join(UPLOADS_ROOT, relPath);
  return fs.readFile(fullPath);
}

/** Delete a resume file from disk. Safe to call if the file is missing. */
export async function deleteResumeObject(relPath: string): Promise<void> {
  const fullPath = path.join(UPLOADS_ROOT, relPath);
  await fs.unlink(fullPath).catch((err) => {
    if (err.code !== "ENOENT") throw err;
  });
}
