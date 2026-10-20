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
