import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/** Runs each recreate variant in its own Electron process and records survival. */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const evidenceDir = path.join(repoRoot, "docs", "evidence", "capture-sprint");
const requireFromDesktop = createRequire(path.join(repoRoot, "artifacts", "desktop-electron", "package.json"));
const electronExe = requireFromDesktop("electron");
const harness = path.join(repoRoot, "scripts", "capture-matrix", "recreate-crash-probe.cjs");
const VARIANTS = [
  { id: "1", description: "destroy protected transparent -> create transparent:false immediately" },
  { id: "2", description: "clear content protection -> destroy -> create opaque immediately" },
  { id: "3", description: "clear content protection -> destroy -> wait 400ms -> create opaque" },
  { id: "4", description: "destroy protected transparent -> create transparent:true" },
  { id: "5", description: "keep A alive, create opaque B (dual-surface)" },
  { id: "6", description: "destroy UNPROTECTED transparent -> create opaque immediately" },
];
fs.mkdirSync(evidenceDir, { recursive: true });
const results = [];
for (const variant of VARIANTS) {
  const logFile = path.join(evidenceDir, "recreate-variant-" + variant.id + ".log");
  const userData = path.join(evidenceDir, "recreate-userdata-" + variant.id);
  fs.rmSync(logFile, { force: true });
  fs.rmSync(userData, { recursive: true, force: true });
  const env = Object.assign({}, process.env, {
    PROBE_VARIANT: variant.id,
    PROBE_LOG: logFile,
    PROBE_USERDATA: userData,
  });
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electronExe, [harness], { cwd: repoRoot, env, encoding: "utf8", timeout: 60000 });
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  const survived = /SURVIVED/.test(log) && run.status === 0;
  const entry = {
    variant: variant.id,
    description: variant.description,
    exit_code: run.status,
    signal: run.signal || null,
    survived,
    log,
    stderr_tail: (run.stderr || "").slice(-1500),
  };
  results.push(entry);
  console.log("[recreate-probe] variant " + variant.id + " -> " + (survived ? "SURVIVED" : "CRASH/FAIL") + " exit=" + run.status);
}
const payload = {
  generated_at: new Date().toISOString(),
  method: "One Electron process per variant; step log appended synchronously; SURVIVED marker + exit code decide pass/fail.",
  electron: requireFromDesktop("electron/package.json").version,
  results,
  conclusion: results.filter((entry) => !entry.survived).map((entry) => entry.variant),
};
fs.writeFileSync(path.join(evidenceDir, "recreate-variants.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify(payload, null, 2).slice(0, 8000));
