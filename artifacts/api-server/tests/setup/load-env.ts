import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Vitest runs without the API server's `node --env-file` flag, so tests that
// import @workspace/db die on a missing DATABASE_URL even when a local .env
// exists. Load the package-local .env at setup time. Absence is non-fatal so
// unit-only runs (and CI with injected env) still work.
const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../.env");

if (!process.env.DATABASE_URL && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// Derive POSTGRES_* connection parts from DATABASE_URL so the dedicated-DB
// integration suites (stripe.integration.test.ts) can build their own URL
// without requiring a second copy of the credentials in the environment.
// Explicit POSTGRES_* values always win.
if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);
    process.env.POSTGRES_USER ??= decodeURIComponent(url.username);
    process.env.POSTGRES_PASSWORD ??= decodeURIComponent(url.password);
    process.env.POSTGRES_HOST ??= url.hostname;
    process.env.POSTGRES_PORT ??= url.port || "5432";
  } catch {
    // Malformed DATABASE_URL: let the consuming code produce its own error.
  }
}
