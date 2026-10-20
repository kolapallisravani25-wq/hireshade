import type { MeetingSignal } from "@/lib/meetingDetection";

export interface MeetingFixture {
  readonly name: string;
  readonly signal: MeetingSignal;
  /** Expected slug, or null when the snapshot must NOT be treated as a meeting. */
  readonly expected: string | null;
  /** Expected signal kinds that fired (order-insensitive check). */
  readonly expectedSignals?: readonly string[];
  readonly minConfidence?: number;
}

/**
 * 3-signal fixture set (T-13): each desktop app is exercised through its macOS
 * bundle id, its Windows process name and a title-only snapshot; each web
 * variant through a browser tab and a URL when available. Confidence ordering
 * and browser/app disambiguation are covered too.
 */
export const MEETING_DETECTION_FIXTURES: readonly MeetingFixture[] = [
  // ── Desktop apps: macOS bundle id ──────────────────────────────────────────
  { name: "zoom mac bundle", signal: { macBundleId: "us.zoom.xos", windowTitle: "Zoom Workplace" }, expected: "zoom", expectedSignals: ["bundleId", "windowTitle"], minConfidence: 0.98 },
  { name: "slack mac bundle", signal: { macBundleId: "com.tinyspeck.slackmacgap", windowTitle: "Slack | #engineering" }, expected: "slack", expectedSignals: ["bundleId", "windowTitle"] },
  { name: "webex mac bundle", signal: { macBundleId: "com.cisco.webexmeetingsapp", windowTitle: "Webex Meetings" }, expected: "webex" },
  { name: "teams mac bundle", signal: { macBundleId: "com.microsoft.teams2", windowTitle: "Microsoft Teams" }, expected: "microsoft_teams" },
  { name: "whatsapp mac bundle", signal: { macBundleId: "net.whatsapp.WhatsApp", windowTitle: "WhatsApp" }, expected: "whatsapp" },
  { name: "lark mac bundle", signal: { macBundleId: "com.electron.lark", windowTitle: "Lark" }, expected: "lark" },
  { name: "chime mac bundle", signal: { macBundleId: "com.amazon.Amazon-Chime", windowTitle: "Amazon Chime" }, expected: "amazon_chime" },
  { name: "discord mac bundle", signal: { macBundleId: "com.hnc.Discord", windowTitle: "Discord" }, expected: "discord" },

  // ── Desktop apps: Windows process name ─────────────────────────────────────
  { name: "zoom windows process", signal: { windowsProcessName: "Zoom.exe", windowTitle: "Zoom Meeting" }, expected: "zoom", expectedSignals: ["processName", "windowTitle"], minConfidence: 0.95 },
  { name: "slack windows process", signal: { windowsProcessName: "slack.exe", windowTitle: "Slack - huddle" }, expected: "slack" },
  { name: "webex windows process", signal: { windowsProcessName: "webexmta.exe", windowTitle: "Webex Meeting" }, expected: "webex" },
  { name: "teams windows process (new client)", signal: { windowsProcessName: "ms-teams.exe", windowTitle: "Microsoft Teams" }, expected: "microsoft_teams" },
  { name: "teams windows process (classic)", signal: { windowsProcessName: "Teams.exe", windowTitle: "Microsoft Teams" }, expected: "microsoft_teams" },
  { name: "whatsapp windows process", signal: { windowsProcessName: "WhatsApp.exe", windowTitle: "WhatsApp" }, expected: "whatsapp" },
  { name: "lark windows process", signal: { windowsProcessName: "Feishu.exe", windowTitle: "飞书" }, expected: "lark" },
  { name: "chime windows process", signal: { windowsProcessName: "Chime.exe", windowTitle: "Amazon Chime" }, expected: "amazon_chime" },
  { name: "discord windows process", signal: { windowsProcessName: "Discord.exe", windowTitle: "Discord" }, expected: "discord" },

  // ── Desktop apps: title-only (lower confidence, still detected) ────────────
  { name: "zoom title only", signal: { windowTitle: "Zoom Meeting" }, expected: "zoom", expectedSignals: ["windowTitle"], minConfidence: 0.6 },
  { name: "webex title only", signal: { windowTitle: "Webex Meetings - Room 3" }, expected: "webex" },
  { name: "teams title only", signal: { windowTitle: "Microsoft Teams" }, expected: "microsoft_teams" },

  // ── Web variants in a browser tab ──────────────────────────────────────────
  { name: "google meet in chrome", signal: { windowsProcessName: "chrome.exe", windowTitle: "Meet - abc-defg-hij - Google Chrome" }, expected: "google_meet", expectedSignals: ["windowTitle"], minConfidence: 0.88 },
  { name: "google meet by url", signal: { macBundleId: "com.google.chrome", windowTitle: "Google Meet", url: "https://meet.google.com/abc-defg-hij" }, expected: "google_meet", expectedSignals: ["url", "windowTitle"], minConfidence: 0.96 },
  { name: "zoom web in firefox", signal: { windowsProcessName: "firefox.exe", windowTitle: "Zoom Meeting - Mozilla Firefox" }, expected: "zoom_web" },
  { name: "zoom web by url", signal: { macBundleId: "com.brave.Browser", windowTitle: "Join Meeting", url: "https://app.zoom.us/wc/123/join" }, expected: "zoom_web" },
  { name: "teams web in edge", signal: { windowsProcessName: "msedge.exe", windowTitle: "Microsoft Teams - Microsoft Edge" }, expected: "microsoft_teams_web" },
  { name: "teams web by url", signal: { macBundleId: "com.apple.Safari", windowTitle: "Chat | Microsoft Teams", url: "https://teams.microsoft.com/l/chat" }, expected: "microsoft_teams_web" },

  // ── Non-meetings / negative cases ──────────────────────────────────────────
  { name: "chrome alone is not a meeting", signal: { windowsProcessName: "chrome.exe", windowTitle: "New Tab - Google Chrome" }, expected: null },
  { name: "safari alone is not a meeting", signal: { macBundleId: "com.apple.Safari", windowTitle: "Apple" }, expected: null },
  { name: "unrelated editor window", signal: { macBundleId: "com.microsoft.VSCode", windowTitle: "sessions.ts — Visual Studio Code" }, expected: null },
  { name: "empty signal", signal: {}, expected: null },
  { name: "generic browser url", signal: { windowsProcessName: "brave.exe", windowTitle: "Docs - Brave", url: "https://example.com" }, expected: null },
];

/** Every required T-13 slug must appear in at least one positive fixture. */
export const REQUIRED_MEETING_SLUGS = [
  "zoom",
  "slack",
  "webex",
  "microsoft_teams",
  "whatsapp",
  "lark",
  "amazon_chime",
  "discord",
  "google_meet",
  "zoom_web",
  "microsoft_teams_web",
  "chrome",
  "firefox",
  "safari",
  "edge",
  "arc",
  "brave",
  "opera",
] as const;
