import app from "./app";
import { logger } from "./lib/logger";

/**
 * Boot-time config health check. These aren't fatal (the API can still serve
 * unaffected routes), but a missing value silently breaks a whole feature — e.g.
 * no DEEPGRAM_API_KEY => transcription fails and only surfaces in the desktop
 * overlay as "system audio unavailable". Log a loud, explicit warning at startup
 * so misconfiguration is obvious in the logs instead of as a mystery at runtime.
 */
function checkConfigHealth(): void {
  const checks: { name: string; ok: boolean; impact: string }[] = [
    {
      name: "CLERK_SECRET_KEY",
      ok: Boolean(process.env["CLERK_SECRET_KEY"]?.trim()),
      impact: "Clerk backend calls (e.g. desktop sign-in ticket) will fail",
    },
    {
      name: "Clerk issuer (VITE_CLERK_PUBLISHABLE_KEY or CLERK_ISSUER_DOMAIN)",
      ok: Boolean(
        process.env["VITE_CLERK_PUBLISHABLE_KEY"]?.trim() ||
          process.env["CLERK_ISSUER_DOMAIN"]?.trim() ||
          process.env["CLERK_DOMAIN"]?.trim(),
      ),
      impact: "token verification cannot resolve the JWKS issuer — all auth 401s",
    },
    {
      name: "DEEPGRAM_API_KEY",
      ok: Boolean(process.env["DEEPGRAM_API_KEY"]?.trim()),
      impact: "live transcription is unavailable",
    },
    {
      name: "DATABASE_URL",
      ok: Boolean(process.env["DATABASE_URL"]?.trim()),
      impact: "the database is unreachable — most routes will fail",
    },
  ];

  const missing = checks.filter((c) => !c.ok);
  if (missing.length === 0) {
    logger.info("Config health check passed");
    return;
  }
  for (const m of missing) {
    logger.warn(
      { setting: m.name, impact: m.impact },
      `CONFIG WARNING: ${m.name} is not set — ${m.impact}`,
    );
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  checkConfigHealth();
  logger.info({ port }, "Server listening");
});
