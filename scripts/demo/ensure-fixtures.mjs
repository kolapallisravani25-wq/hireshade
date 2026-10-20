#!/usr/bin/env node
/**
 * Ensures fixture WAVs exist (used by tests, the demo runner and make targets).
 * Regenerates only when a fixture is missing or --force is passed.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const generator = path.join(here, "generate-fixtures.mjs");
const runs = spawnSync(process.execPath, [generator, ...process.argv.slice(2)], {
  encoding: "utf8",
  stdio: "inherit",
});
process.exit(runs.status ?? 1);
