import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Load api-server/.env (when present) before any test imports the DB
    // module — Vitest does not inherit Node --env-file behavior.
    setupFiles: ["tests/setup/load-env.ts"],
    // Integration tests share one database — run files serially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
