#!/usr/bin/env node
/**
 * Zero-key demo orchestrator (G-001/G-004/G-005).
 *
 * Usage:
 *   node scripts/demo/run-demo.mjs demo        # full proof: fixtures -> tests -> pipeline -> overlay e2e
 *   node scripts/demo/run-demo.mjs fixtures    # generate/refresh the ffmpeg WAV fixtures
 *   node scripts/demo/run-demo.mjs tests       # unit tests for every new module (both packages)
 *   node scripts/demo/run-demo.mjs pipeline    # latency proof + docs/evidence/demo/*
 *   node scripts/demo/run-demo.mjs e2e         # Electron overlay CDP DOM proof
 *   node scripts/demo/run-demo.mjs help
 *
 * Extra args are forwarded to the pipeline step, e.g.:
 *   node scripts/demo/run-demo.mjs pipeline --runs=3 --models=gpt-5,gemini-3-1-flash-lite
 *
 * Every child process runs with ALL provider keys removed and DEMO_MODE=1, so a
 * green run proves the demo needs no OpenRouter/Deepgram/Clerk credentials.
 * No GNU make dependency: the root Makefile delegates here.
 */
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const PROVIDER_KEYS = [
  "OPENROUTER_API_KEY",
  "DEEPGRAM_API_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_ISSUER_DOMAIN",
  "CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "VITE_DEEPGRAM_API_KEY",
  "DATABASE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

/** Builds the zero-key child environment and reports what was removed. */
function sanitizedEnv() {
  const env = { ...process.env };
  const removed = [];
  for (const key of PROVIDER_KEYS) {
    if (env[key] !== undefined && env[key] !== "") removed.push(key);
    delete env[key];
  }
  // Some harnesses export this so the Electron binary behaves as plain Node;
  // it would disable the overlay app, and it is irrelevant for the node steps.
  if (env.ELECTRON_RUN_AS_NODE) {
    removed.push("ELECTRON_RUN_AS_NODE");
    delete env.ELECTRON_RUN_AS_NODE;
  }
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") {
    console.error("[demo] refusing to run: NODE_ENV=production (DEMO_MODE fails closed in production)");
    process.exit(2);
  }
  env.NODE_ENV = "development";
  env.DEMO_MODE = "1";
  // Extension flags: the keyless demo exercises W4 gaze and W1 pronunciation
  // stages; both are off by default outside make demo so existing output is stable.
  env.DEMO_GAZE = "1";
  env.DEMO_PRONUNCIATION = "1";
  return { env, removed };
}

function run(label, command, args, options = {}) {
  console.log("");
  console.log("[demo] == " + label + " ==");
  console.log("[demo] $ " + [command, ...args].join(" "));
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? sanitizedEnv().env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error("[demo] spawn failed: " + result.error.message);
    return 1;
  }
  if (result.status !== 0) console.error("[demo] step failed: " + label + " (exit " + result.status + ")");
  return result.status ?? 1;
}

function findTsxCli() {
  const candidates = [
    path.join(root, "artifacts", "api-server", "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "artifacts", "craft-vita", "node_modules", "tsx", "dist", "cli.mjs"),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const pnpmStore = path.join(root, "node_modules", ".pnpm");
  if (existsSync(pnpmStore)) {
    for (const dir of readdirSync(pnpmStore)) {
      if (!dir.startsWith("tsx@")) continue;
      const candidate = path.join(pnpmStore, dir, "node_modules", "tsx", "dist", "cli.mjs");
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Cannot locate the tsx CLI (pnpm workspace dependency missing?)");
}

function findVitestCwd(cwd) {
  const candidates = [
    path.join(cwd, "node_modules", "vitest", "vitest.mjs"),
    path.join(cwd, "node_modules", "vitest", "dist", "cli.js"),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error("Cannot locate vitest in " + cwd);
}

function stepFixtures(env) {
  return run("fixtures (ffmpeg)", process.execPath, [path.join(here, "generate-fixtures.mjs")], { env });
}

function stepTests(env) {
  const craftVita = path.join(root, "artifacts", "craft-vita");
  const apiServer = path.join(root, "artifacts", "api-server");
  const craftVitest = findVitestCwd(craftVita);
  const apiVitest = findVitestCwd(apiServer);

  const demo = run(
    "unit tests - demo/VAD/overlay modules (craft-vita)",
    process.execPath,
    [craftVitest, "run", "src/demo", "--reporter=dot"],
    { cwd: craftVita, env },
  );
  if (demo !== 0) return demo;

  return run(
    "unit tests - provider/mock layer (api-server)",
    process.execPath,
    [apiVitest, "run", "--root", "src/lib/mocks", "--reporter=dot"],
    { cwd: apiServer, env },
  );
}

function stepPipeline(env, passthrough) {
  const craftVita = path.join(root, "artifacts", "craft-vita");
  const tsx = findTsxCli();
  return run(
    "pipeline + latency budget + evidence",
    process.execPath,
    [tsx, path.join("src", "demo", "run-demo.ts"), ...passthrough],
    { cwd: craftVita, env },
  );
}

function stepExtensions(env) {
  const craftVita = path.join(root, "artifacts", "craft-vita");
  const apiServer = path.join(root, "artifacts", "api-server");
  const craftVitest = findVitestCwd(craftVita);
  const apiVitest = findVitestCwd(apiServer);

  const craft = run(
    "extensions - W1 pronunciation + W2 auto-scroll + W4 gaze tests (craft-vita)",
    process.execPath,
    [craftVitest, "run", "src/features/pronunciation", "src/fixtures/pronunciation", "src/overlay/autoscroll", "src/gaze", "--reporter=dot"],
    { cwd: craftVita, env },
  );
  if (craft !== 0) return craft;

  const scroll = run(
    "extensions - W2 auto-scroll Electron/CDP proof",
    process.execPath,
    [path.join(here, "..", "scroll", "overlay-scroll-e2e.mjs")],
    { cwd: root, env },
  );
  if (scroll !== 0) return scroll;

  return run(
    "extensions - W3 Razorpay unit suite (no DB, mock adapter)",
    process.execPath,
    [apiVitest, "run", "tests/razorpay.unit.test.ts", "--reporter=dot"],
    { cwd: apiServer, env },
  );
}

function stepE2e(env) {
  return run("overlay e2e (Electron + CDP DOM)", process.execPath, [path.join(here, "overlay-e2e.mjs")], {
    cwd: root,
    env,
  });
}

function help() {
  console.log(`HireShade zero-key demo

  node scripts/demo/run-demo.mjs demo        full proof (fixtures -> tests -> pipeline -> overlay e2e)
  node scripts/demo/run-demo.mjs fixtures    generate/refresh ffmpeg WAV fixtures
  node scripts/demo/run-demo.mjs tests       unit tests for every new module
  node scripts/demo/run-demo.mjs pipeline    latency budget + docs/evidence/demo/* (accepts --runs=N --models=a,b)
  node scripts/demo/run-demo.mjs e2e         Electron overlay CDP DOM proof + screenshot
  node scripts/demo/run-demo.mjs extensions  W1 pronunciation + W2 auto-scroll + W3 Razorpay mock + W4 gaze
  node scripts/demo/run-demo.mjs help

All steps run with DEMO_MODE=1 and every provider key removed.`);
}

function main() {
  const [target = "demo", ...passthrough] = process.argv.slice(2);
  const { env, removed } = sanitizedEnv();
  console.log("[demo] target=" + target + " node=" + process.version + " platform=" + process.platform);
  console.log("[demo] DEMO_MODE=1 NODE_ENV=development");
  console.log("[demo] provider keys removed for children: " + (removed.length ? removed.join(", ") : "none were set"));
  for (const key of PROVIDER_KEYS) {
    if (env[key] !== undefined) {
      console.error("[demo] refusing to continue: provider key survived sanitization: " + key);
      process.exit(2);
    }
  }

  let status = 0;
  switch (target) {
    case "help":
      help();
      return;
    case "fixtures":
      status = stepFixtures(env);
      break;
    case "tests":
      status = stepTests(env);
      break;
    case "pipeline":
      status = stepPipeline(env, passthrough);
      break;
    case "e2e":
      status = stepE2e(env);
      break;
    case "extensions":
      status = stepExtensions(env);
      break;
    case "demo": {
      status = stepFixtures(env);
      if (status === 0) status = stepTests(env);
      if (status === 0) status = stepPipeline(env, passthrough);
      if (status === 0) status = stepExtensions(env);
      if (status === 0) status = stepE2e(env);
      break;
    }
    default:
      console.error("[demo] unknown target: " + target);
      help();
      status = 2;
  }

  console.log("");
  if (status === 0) {
    console.log("[demo] ALL GREEN - keyless demo + latency budget + extensions (W1-W4) + overlay DOM proof passed.");
    console.log("[demo] evidence: docs/evidence/demo/*, docs/evidence/overlay-scroll/*, docs/evidence/gaze/*, docs/evidence/pronunciation/*, docs/evidence/razorpay/*");
  } else {
    console.error("[demo] FAILED (exit " + status + ")");
  }
  process.exit(status);
}

main();
