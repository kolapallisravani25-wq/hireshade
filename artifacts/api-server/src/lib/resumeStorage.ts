import fs from "fs/promises";
import path from "path";

// Local-disk storage: files live under `uploads/resumes/` and are served by
// the static `/uploads` mount in app.ts (same pattern already used for
// documents). No sidecar dependency, so this works on any host.
const UPLOADS_ROOT = path.join(process.cwd(), "uploads", "resumes");

function publicBaseUrl(): string {
  return process.env["PUBLIC_BACKEND_URL"] ?? "";
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

/** Returns a URL for viewing/downloading a resume (served via the static /uploads mount). */
export async function getResumeSignedUrl(relPath: string, _ttlSec = 900): Promise<string> {
  return `${publicBaseUrl()}/uploads/resumes/${relPath}`;
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
