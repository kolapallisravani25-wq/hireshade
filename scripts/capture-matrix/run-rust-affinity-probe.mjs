import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * S1 option (b): in-process WDA mode experiment on a Win32 window owned by the
 * probe process itself (Windows only allows SetWindowDisplayAffinity on windows
 * owned by the calling process). The probe is a tiny Rust binary built from
 * scripts/capture-matrix/rust-affinity-probe.
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const evidenceDir = path.join(repoRoot, "docs", "evidence", "capture-sprint");
const exe = path.join(repoRoot, "scripts", "capture-matrix", "rust-affinity-probe", "target", "debug", "affinity-probe.exe");
const TITLE = "HireShade Affinity Probe";
const MODES = [
  { id: "0x00", mode: "none" },
  { id: "0x01", mode: "monitor" },
  { id: "0x11", mode: "exclude" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPowerShell(scriptName, args) {
  const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "scripts", "capture-matrix", scriptName), ...args], {
    cwd: repoRoot, encoding: "utf8", timeout: 120000,
  });
  const stdout = (run.stdout || "").trim().replace(/^\uFEFF/, "");
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (run.status !== 0 || start < 0 || end <= start) return { ok: false, raw: stdout + (run.stderr || "") };
  try { return { ok: true, value: JSON.parse(stdout.slice(start, end + 1)) }; } catch (error) { return { ok: false, raw: stdout, error: String(error) }; }
}

function ddagrab(label) {
  const mp4 = path.join(evidenceDir, "rust-ddagrab-" + label + ".mp4");
  const frame = path.join(evidenceDir, "rust-ddagrab-" + label + "-frame.png");
  const record = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "ddagrab=0:framerate=10", "-t", "1", "-vf", "hwdownload,format=bgra", mp4], { encoding: "utf8", timeout: 120000 });
  if (record.status !== 0) return { ok: false, error: (record.stderr || "").slice(-1200) };
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-frames:v", "1", frame], { encoding: "utf8", timeout: 60000 });
  return { ok: true, mp4, frame };
}

async function runMode(mode) {
  const child = spawn(exe, [], {
    cwd: path.dirname(exe),
    env: Object.assign({}, process.env, { AFFINITY_MODE: mode.mode, AFFINITY_SECONDS: "8" }),
    stdio: ["ignore", "pipe", "ignore"],
  });
  const info = await new Promise((resolve) => {
    let buffer = "";
    const timer = setTimeout(() => resolve(null), 5000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes("\n")) {
        clearTimeout(timer);
        try { resolve(JSON.parse(buffer.split("\n")[0])); } catch { resolve(null); }
      }
    });
    child.on("cexec", () => resolve(null));
  });
  if (!info) { try { child.kill(); } catch { /* ignore */ } return { mode: mode.id, error: "probe did not report" }; }
  await sleep(700);
  const bounds = [info.bounds.x, info.bounds.y, info.bounds.width, info.bounds.height].join(",");
  const gdi = runPowerShell("gdi-grab.ps1", ["-OutDir", evidenceDir, "-Label", "rust-" + mode.id, "-Bounds", bounds, "-Note", "Rust in-process affinity probe " + mode.id]);
  const pw = runPowerShell("printwindow.ps1", ["-OutDir", evidenceDir, "-Label", "rust-" + mode.id, "-Title", TITLE]);
  const dd = ddagrab("rust-" + mode.id);
  const crop = gdi.ok ? runPowerShell("crop-stats.ps1", ["-In", gdi.value.crop_path, "-Rect", "0,0," + info.bounds.width + "," + info.bounds.height, "-OutFile", path.join(evidenceDir, "rust-crop-" + mode.id + ".json"), "-Label", "rust-" + mode.id]) : { ok: false };
  try { child.kill(); } catch { /* ignore */ }
  await sleep(400);
  return {
    mode: mode.id,
    probe: info,
    gdi: gdi.ok ? gdi.value : { error: gdi.raw },
    printwindow: pw.ok ? pw.value : { error: pw.raw },
    ddagrab: dd,
    crop_stats: crop.ok ? crop.value : null,
  };
}

function diff(label, a, b, rect) {
  const args = ["-A", a, "-B", b, "-OutFile", path.join(evidenceDir, "rust-diff-" + label + ".json"), "-Label", label];
  if (rect) args.push("-Rect", rect);
  const run = runPowerShell("image-diff.ps1", args);
  return run.ok ? run.value : { error: run.raw };
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (!fs.existsSync(exe)) throw new Error("probe binary missing: " + exe + " (cargo build --offline --manifest-path scripts/capture-matrix/rust-affinity-probe/Cargo.toml)");
  const result = { generated_at: new Date().toISOString(), method: "Self-owned Win32 window (Rust, windows crate) sets SetWindowDisplayAffinity in-process, paints black/white stripes, then GDI/ddagrab/PrintWindow captures are compared between 0x00, 0x01 and 0x11 runs.", runs: [] };
  for (const mode of MODES) {
    const run = await runMode(mode);
    result.runs.push(run);
    console.log("[rust-affinity] " + mode.id + " set_ok=" + (run.probe ? run.probe.set_ok : "?") + " readback=" + (run.probe ? run.probe.readback : "?"));
  }
  const byMode = Object.fromEntries(result.runs.map((run) => [run.mode, run]));
  const rect = byMode["0x00"] && byMode["0x00"].probe ? byMode["0x00"].probe.bounds.width + "," + byMode["0x00"].probe.bounds.height : null;
  const gdiRect = byMode["0x00"] && byMode["0x00"].probe ? [byMode["0x00"].probe.bounds.x, byMode["0x00"].probe.bounds.y, byMode["0x00"].probe.bounds.width, byMode["0x00"].probe.bounds.height].join(",") : null;
  const d00 = byMode["0x00"] || {};
  const d01 = byMode["0x01"] || {};
  const d11 = byMode["0x11"] || {};
  const diff01Gdi = d00.gdi && d01.gdi && d00.gdi.crop_path && d01.gdi.crop_path ? diff("gdi-0x01-vs-0x00", d00.gdi.crop_path, d01.gdi.crop_path) : { error: "missing" };
  const diff11Gdi = d00.gdi && d11.gdi && d00.gdi.crop_path && d11.gdi.crop_path ? diff("gdi-0x11-vs-0x00", d00.gdi.crop_path, d11.gdi.crop_path) : { error: "missing" };
  const diff01Dxgi = d00.ddagrab && d01.ddagrab && d00.ddagrab.frame && d01.ddagrab.frame ? diff("ddagrab-0x01-vs-0x00", d00.ddagrab.frame, d01.ddagrab.frame, gdiRect) : { error: "missing" };
  const diff11Dxgi = d00.ddagrab && d11.ddagrab && d00.ddagrab.frame && d11.ddagrab.frame ? diff("ddagrab-0x11-vs-0x00", d00.ddagrab.frame, d11.ddagrab.frame, gdiRect) : { error: "missing" };
  const stats01 = d01.crop_stats;
  const stats11 = d11.crop_stats;
  result.comparisons = { gdi_0x01_vs_0x00: diff01Gdi, gdi_0x11_vs_0x00: diff11Gdi, ddagrab_0x01_vs_0x00: diff01Dxgi, ddagrab_0x11_vs_0x00: diff11Dxgi };
  result.conclusions = {
    "0x01_set_on_self_owned_window": Boolean(d01.probe && d01.probe.set_ok && d01.probe.readback === 1),
    "0x01_gdi_behaviour":
      diff01Gdi.fraction_diff_gt_threshold === undefined
        ? "UNTESTED"
        : stats01 && stats01.black_fraction >= 0.9 && stats01.unique_colors_sampled <= 20
          ? "BLACK_BAR (0x01 accepted: window rendered black in GDI capture; diff vs 0x00 " + diff01Gdi.fraction_diff_gt_threshold + ")"
          : diff01Gdi.fraction_diff_gt_threshold <= 0.01
            ? "0x01 IGNORED (GDI capture identical to 0x00 content)"
            : "PARTIAL/CHANGED (review numbers)",
    "0x01_dxgi_behaviour":
      diff01Dxgi.fraction_diff_gt_threshold === undefined
        ? "UNTESTED"
        : diff01Dxgi.fraction_diff_gt_threshold <= 0.05
          ? "DXGI IGNORES 0x01 (frame content identical to 0x00; diff " + diff01Dxgi.fraction_diff_gt_threshold + ")"
          : "DXGI CHANGED with 0x01 (diff " + diff01Dxgi.fraction_diff_gt_threshold + "; review frames)",
    "0x11_dxgi_behaviour":
      diff11Dxgi.fraction_diff_gt_threshold === undefined
        ? "UNTESTED"
        : diff11Dxgi.fraction_diff_gt_threshold <= 0.05
          ? "DXGI IGNORES 0x11 (frame content identical to 0x00; diff " + diff11Dxgi.fraction_diff_gt_threshold + ")"
          : "DXGI excludes 0x11 (diff " + diff11Dxgi.fraction_diff_gt_threshold + ")",
  };
  fs.writeFileSync(path.join(evidenceDir, "rust-affinity-probe.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result.conclusions, null, 2));
}

main().catch((error) => { console.error("[rust-affinity] " + (error && error.stack ? error.stack : error)); process.exitCode = 1; });
