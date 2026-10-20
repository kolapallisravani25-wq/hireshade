/**
 * Curated, versioned tested-app risk list (S3 / EXT G-053).
 *
 * DATA ONLY - no logic branches here. Risk is classified per capture-path
 * KNOWLEDGE from docs/CAPTURE_MATRIX.md, not by observing an app at runtime:
 *
 *   OBSERVED (matrix): GDI/gdigrab/Chromium screen+window capture honour
 *   WDA_EXCLUDEFROMCAPTURE; PrintWindow shows no content; DXGI Desktop
 *   Duplication IGNORES it. Native desktop screen-share modes in meeting apps
 *   typically use DXGI/hardware capture; browser window/tab share uses
 *   Chromium capture. Which path a specific app picks at runtime is NOT
 *   observable by HireShade - hence the honest copy in preflight.ts.
 *
 * Stamped/versioned: bump TESTED_APPS_META.listVersion + testedOn whenever an
 * entry's evidence changes. Tests validate the stamp, uniqueness and patterns.
 */

export const TESTED_APPS_SCHEMA_VERSION = 1;
export const TESTED_APPS_LIST_VERSION = "2026.10.20.1";
/** ISO date of the last manual verification pass for this list. */
export const TESTED_APPS_TESTED_ON = "2026-10-20";

export type CaptureRisk = "low" | "medium" | "high" | "unknown";
export type EvidenceStatus = "OBSERVED" | "INFERRED" | "UNTESTED";

export interface TestedApp {
  readonly id: string;
  readonly label: string;
  readonly platforms: readonly ("win32" | "darwin" | "linux")[];
  /** Windows process names, lowercase, .exe optional. */
  readonly processNames: readonly string[];
  /** Window/tab title patterns as regex SOURCE strings (data, not compiled). */
  readonly windowTitlePatterns: readonly string[];
  /** Risk that capture exclusion is not honoured for this app's likely path. */
  readonly captureRisk: CaptureRisk;
  readonly riskReason: string;
  readonly evidenceStatus: EvidenceStatus;
  /** Most recent manual test date, null when never tested on this host. */
  readonly lastTestedOn: string | null;
}

export interface TestedAppsMeta {
  readonly schemaVersion: number;
  readonly listVersion: string;
  readonly testedOn: string;
  readonly source: string;
  readonly notes: string;
}

export const TESTED_APPS_META: TestedAppsMeta = {
  schemaVersion: TESTED_APPS_SCHEMA_VERSION,
  listVersion: TESTED_APPS_LIST_VERSION,
  testedOn: TESTED_APPS_TESTED_ON,
  source: "docs/CAPTURE_MATRIX.md + docs/evidence/capture-sprint/preflight",
  notes:
    "Risk is per capture-path family, not per-app runtime detection. DXGI Desktop Duplication ignores WDA_EXCLUDEFROMCAPTURE (OBSERVED); Chromium window/tab capture and GDI honour it (OBSERVED); native app screen share paths are UNTESTED directly and classified INFERRED.",
};

export const TESTED_APPS: readonly TestedApp[] = [
  {
    id: "zoom",
    label: "Zoom",
    platforms: ["win32", "darwin"],
    processNames: ["zoom.exe", "zoom"],
    windowTitlePatterns: ["\\bzoom\\b", "zoom meeting", "zoom workplace"],
    captureRisk: "high",
    riskReason:
      "Native desktop screen share is expected to use hardware/DXGI-family capture, which ignores window capture exclusion (DXGI row OBSERVED); the exact Zoom path is UNTESTED.",
    evidenceStatus: "INFERRED",
    lastTestedOn: null,
  },
  {
    id: "microsoft-teams",
    label: "Microsoft Teams",
    platforms: ["win32", "darwin"],
    processNames: ["ms-teams.exe", "teams.exe", "ms-teams"],
    windowTitlePatterns: ["microsoft teams", "\\bteams\\b"],
    captureRisk: "high",
    riskReason:
      "Native Teams screen share is expected to use hardware capture (DXGI family). Untested directly.",
    evidenceStatus: "INFERRED",
    lastTestedOn: null,
  },
  {
    id: "google-meet",
    label: "Google Meet (browser)",
    platforms: ["win32", "darwin", "linux"],
    processNames: ["chrome.exe", "msedge.exe", "firefox.exe", "safari"],
    windowTitlePatterns: ["\\bgoogle meet\\b", "meet.google.com", "^meet\\s*[-–—]"],
    captureRisk: "medium",
    riskReason:
      "Browser tab/window shares use Chromium capture, which honoured exclusion in the OBSERVED desktopCapturer screen/window rows; full-screen browser share is UNTESTED.",
    evidenceStatus: "INFERRED",
    lastTestedOn: null,
  },
  {
    id: "webex",
    label: "Webex",
    platforms: ["win32", "darwin"],
    processNames: ["webexmta.exe", "webex.exe", "atmgr.exe"],
    windowTitlePatterns: ["\\bwebex\\b"],
    captureRisk: "high",
    riskReason: "Native meeting app; expected hardware capture family. Untested directly.",
    evidenceStatus: "INFERRED",
    lastTestedOn: null,
  },
  {
    id: "discord",
    label: "Discord",
    platforms: ["win32", "darwin"],
    processNames: ["discord.exe", "discord"],
    windowTitlePatterns: ["\\bdiscord\\b"],
    captureRisk: "high",
    riskReason: "Discord screen share is known to use hardware/Desktop Duplication capture; untested here.",
    evidenceStatus: "INFERRED",
    lastTestedOn: null,
  },
  {
    id: "obs",
    label: "OBS Studio",
    platforms: ["win32", "darwin", "linux"],
    processNames: ["obs64.exe", "obs.exe"],
    windowTitlePatterns: ["\\bobs\\b", "obs studio"],
    captureRisk: "high",
    riskReason:
      "OBS display capture commonly uses Desktop Duplication; the DXGI row in docs/CAPTURE_MATRIX.md is OBSERVED to ignore WDA_EXCLUDEFROMCAPTURE.",
    evidenceStatus: "OBSERVED",
    lastTestedOn: TESTED_APPS_TESTED_ON,
  },
  {
    id: "slack",
    label: "Slack (huddle)",
    platforms: ["win32", "darwin"],
    processNames: ["slack.exe", "slack"],
    windowTitlePatterns: ["\\bslack\\b", "slack huddle"],
    captureRisk: "medium",
    riskReason: "Electron/Chromium app; window sharing likely honours exclusion (Chromium rows OBSERVED), huddle screen share path UNTESTED.",
    evidenceStatus: "INFERRED",
    lastTestedOn: null,
  },
  {
    id: "lark",
    label: "Lark / Feishu",
    platforms: ["win32", "darwin", "linux"],
    processNames: ["lark.exe", "feishu.exe", "lark"],
    windowTitlePatterns: ["\\blark\\b", "\\bfeishu\\b", "\\u98de\\u4e66"],
    captureRisk: "medium",
    riskReason: "Chromium-based desktop app; screen-share capture path UNTESTED.",
    evidenceStatus: "UNTESTED",
    lastTestedOn: null,
  },
  {
    id: "amazon-chime",
    label: "Amazon Chime",
    platforms: ["win32", "darwin"],
    processNames: ["chime.exe", "amazonchime.exe"],
    windowTitlePatterns: ["amazon chime", "\\bchime\\b"],
    captureRisk: "medium",
    riskReason: "Native/Electron meeting app; screen-share capture path UNTESTED.",
    evidenceStatus: "UNTESTED",
    lastTestedOn: null,
  },
  {
    id: "coderpad",
    label: "CoderPad (browser)",
    platforms: ["win32", "darwin", "linux"],
    processNames: ["chrome.exe", "msedge.exe", "firefox.exe", "safari"],
    windowTitlePatterns: ["coderpad"],
    captureRisk: "medium",
    riskReason: "Browser tab; Chromium window/tab capture OBSERVED to honour exclusion, full-screen browser share UNTESTED.",
    evidenceStatus: "INFERRED",
    lastTestedOn: null,
  },
  {
    id: "hackerrank",
    label: "HackerRank (browser)",
    platforms: ["win32", "darwin", "linux"],
    processNames: ["chrome.exe", "msedge.exe", "firefox.exe", "safari"],
    windowTitlePatterns: ["hackerrank"],
    captureRisk: "medium",
    riskReason: "Browser tab; Chromium window/tab capture OBSERVED to honour exclusion, full-screen browser share UNTESTED.",
    evidenceStatus: "INFERRED",
    lastTestedOn: null,
  },
];
