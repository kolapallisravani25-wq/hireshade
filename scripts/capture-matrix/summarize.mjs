import fs from "node:fs";
import path from "node:path";

/**
 * Summarize the O2 capture-matrix evidence files into one machine-readable
 * summary + console table. Re-runnable without re-capturing anything.
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const dir = path.join(repoRoot, "docs", "evidence", "overlay-size");

function read(name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return null;
  try {
    // PowerShell 5.1 Set-Content -Encoding UTF8 writes a BOM.
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function exists(name) {
  return fs.existsSync(path.join(dir, name));
}

function affinitySummary(prefix) {
  const info = read(prefix + ".json");
  if (!info) return { file: prefix + ".json", missing: true };
  return {
    file: prefix + ".json",
    expect: info.expect,
    pass: info.pass,
    matching: (info.matching || []).map((entry) => ({ title: entry.title, visible: entry.visible, affinity: entry.affinity, pass: entry.pass })),
  };
}

function trial(profile) {
  const gdiOn = read("gdi-" + profile + "-stealth-on.json");
  const gdiHidden = read("gdi-" + profile + "-hidden-baseline.json");
  const gdiOff = read("gdi-" + profile + "-stealth-off.json");
  const gdiOnDiff = read("diff-" + profile + "-gdi-on-vs-baseline.json");
  const gdiOffDiff = read("diff-" + profile + "-gdi-off-vs-baseline.json");
  const probeOn = read("desktopcapturer-" + profile + "-stealth-on.json");
  const probeHidden = read("desktopcapturer-" + profile + "-hidden-baseline.json");
  const probeOff = read("desktopcapturer-" + profile + "-stealth-off.json");
  const probeOnDiff = read("diff-" + profile + "-desktopcapturer-on-vs-baseline.json");
  const probeOffDiff = read("diff-" + profile + "-desktopcapturer-off-vs-baseline.json");
  const printOn = read("printwindow-" + profile + "-stealth-on.json");
  const printOff = read("printwindow-" + profile + "-stealth-off.json");
  const printDiff = read("diff-" + profile + "-printwindow-on-vs-off.json");

  const classify = (onDiff, offDiff) => {
    if (!onDiff || !offDiff) return "MISSING";
    const on = onDiff.fraction_diff_gt_threshold;
    const off = offDiff.fraction_diff_gt_threshold;
    if (on <= 0.002 && off >= 0.01) return "HONORS_EXCLUSION";
    if (on >= 0.01) return "VISIBLE_IN_CAPTURE";
    return "INCONCLUSIVE";
  };

  const printContent = (info) => {
    if (!info || !info.stats) return null;
    const s = info.stats;
    return {
      printwindow_ok: info.printwindow_ok,
      flag_used: info.flag_used,
      mean_luma: s.mean_luma,
      std_luma: s.std_luma,
      black_fraction: s.black_fraction,
      has_content: s.mean_luma > 5 && s.black_fraction < 0.9,
    };
  };
  const onContent = printContent(printOn);
  const offContent = printContent(printOff);
  let printVerdict = "MISSING";
  if (onContent && offContent) {
    if (onContent.has_content) printVerdict = "VISIBLE_IN_CAPTURE (PrintWindow rendered protected content)";
    else if (offContent.has_content) printVerdict = "HIDDEN_IN_PRINTWINDOW (black when protected; content when stealth is off)";
    else printVerdict = "INCONCLUSIVE_BLACK_BOTH";
  }

  const windowSourceSizes = (probe) => {
    if (!probe || !probe.window_sources) return [];
    return probe.window_sources.map((source) => ({ name: source.name, thumbnail_size: source.thumbnail_size }));
  };

  return {
    profile,
    gdi: {
      method: "GDI CopyFromScreen, cropped to overlay rect; hidden baseline same rect",
      on_vs_baseline_fraction: gdiOnDiff ? gdiOnDiff.fraction_diff_gt_threshold : null,
      off_vs_baseline_fraction: gdiOffDiff ? gdiOffDiff.fraction_diff_gt_threshold : null,
      stealth_on_stats: gdiOn ? gdiOn.stats : null,
      stealth_off_stats: gdiOff ? gdiOff.stats : null,
      verdict: classify(gdiOnDiff, gdiOffDiff),
    },
    chromium_desktopcapturer_screen: {
      method: "Electron desktopCapturer.getSources({types:['screen']}) thumbnail; hidden-vs-on/off full-screen diff",
      on_vs_baseline_fraction: probeOnDiff ? probeOnDiff.fraction_diff_gt_threshold : null,
      off_vs_baseline_fraction: probeOffDiff ? probeOffDiff.fraction_diff_gt_threshold : null,
      verdict: classify(probeOnDiff, probeOffDiff),
      wgc_errors_in_log: "see main.log / probe stderr",
    },
    printwindow: {
      method: "user32 PrintWindow (PW_RENDERFULLCONTENT then 0); ON vs OFF",
      stealth_on: onContent,
      stealth_off: offContent,
      on_vs_off_fraction: printDiff ? printDiff.fraction_diff_gt_threshold : null,
      verdict: printVerdict,
    },
    chromium_desktopcapturer_window: {
      stealth_on_window_sources: windowSourceSizes(probeOn),
      stealth_off_window_sources: windowSourceSizes(probeOff),
      verdict:
        windowSourceSizes(probeOn).length > 0 && windowSourceSizes(probeOff).length > 0
          ? "ON and OFF window-source thumbnails captured; compare sizes/content in the JSON/PNGs"
          : "NO_WINDOW_SOURCE",
    },
    recordings: {
      on_mp4: exists("gdigrab-" + profile + "-stealth-on.mp4"),
      off_mp4: exists("gdigrab-" + profile + "-stealth-off.mp4"),
      on_frame: exists("gdigrab-" + profile + "-stealth-on-frame.png"),
      off_frame: exists("gdigrab-" + profile + "-stealth-off-frame.png"),
      on_vs_off_frame_diff: read("diff-" + profile + "-gdigrab-on-vs-off-frame.json"),
    },
  };
}

const transitions = fs
  .readdirSync(dir)
  .filter((name) => name.startsWith("affinity-") && name.endsWith(".json") && !name.includes("compat") && !name.includes("stealth"))
  .sort()
  .map((name) => affinitySummary(name.replace(/\.json$/, "")));

const summary = {
  generated_at: new Date().toISOString(),
  evidence_dir: path.relative(repoRoot, dir),
  transitions,
  capture_trials: ["banner", "reading"].map(trial),
  compatibility: {
    affinity: affinitySummary("affinity-compat-mode-on-reading"),
    gdi: read("gdi-compat-mode-on-reading.json"),
    note: "Compatibility mode recreates the floating BrowserWindow with transparent:false + #0b0d12 scrim. The orchestrator hung after recreation while waiting for the new CDP target; the affinity/GDI capture was completed manually against the recreated window.",
  },
  dxgi_ddagrab: read("ddagrab-result.json"),
  dpi_simulation: read("dpi-simulation.json"),
  files_present: fs.readdirSync(dir).filter((name) => !fs.statSync(path.join(dir, name)).isDirectory()).sort(),
};

fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(JSON.stringify(summary, null, 2));
