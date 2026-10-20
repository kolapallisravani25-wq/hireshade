/**
 * Meeting auto-detection parser (G-026), modelled on the target's 3-signal
 * detector (T-13).
 *
 * The target's Electron main process polls the foreground window and matches a
 * data-driven table of ~20 slugs with THREE signal kinds:
 *
 *   1. macOS bundle id      (\`appIds\`)
 *   2. Windows process name (\`processNames\`)
 *   3. window title         (\`namePatterns\` for desktop apps, \`titlePatterns\`
 *                            for browser tabs / web variants)
 *
 * plus a browser table (chrome/firefox/safari/edge/arc/brave/opera) so a meeting
 * running in a tab can be told apart from the desktop app. This module is a PURE
 * parser: it takes a snapshot of already-collected signals and returns the
 * platform + confidence. Collecting the signals (Electron main → IPC) lives in
 * \`features/meetingDetection/meetingAutoDetector.ts\`, which is guarded and
 * no-ops when the IPC bridge is unavailable.
 */

export type MeetingPlatformKind = "app" | "web" | "browser";

export interface MeetingPlatformDef {
  /** Stable slug used by the app/overlay (matches the target's naming style). */
  readonly slug: string;
  readonly label: string;
  readonly kind: MeetingPlatformKind;
  /** macOS bundle identifiers (lowercase). */
  readonly appIds?: readonly string[];
  /** Windows process/executable names (lowercase, ".exe" optional). */
  readonly processNames?: readonly string[];
  /** Desktop-app window-title patterns. */
  readonly namePatterns?: readonly RegExp[];
  /** Browser-tab title patterns (web variants + browsers). */
  readonly titlePatterns?: readonly RegExp[];
  /** Browser URL patterns (web variants). */
  readonly urlPatterns?: readonly RegExp[];
  /** Confidence for a title-only match (no process/bundle proof). */
  readonly titleConfidence?: number;
}

export type MeetingSignalKind = "bundleId" | "processName" | "windowTitle" | "url";

export interface MeetingSignal {
  /** macOS primary window owner bundle id, e.g. "us.zoom.xos". */
  macBundleId?: string;
  /** Windows foreground process name, e.g. "Zoom.exe". */
  windowsProcessName?: string;
  /** Foreground window / browser tab title. */
  windowTitle?: string;
  /** Browser URL when available (browser extensions / webviews). */
  url?: string;
}

export interface MeetingDetection {
  slug: string;
  label: string;
  kind: Exclude<MeetingPlatformKind, "browser">;
  /** 0..1 — see the constants below for how each signal contributes. */
  confidence: number;
  matchedSignals: MeetingSignalKind[];
  /** Set when the meeting is running inside one of the known browsers. */
  browserSlug?: string;
  isBrowserMeeting: boolean;
}

const CONFIDENCE = {
  appBundleId: 0.98,
  appProcessName: 0.95,
  appTitleOnly: 0.7,
  webUrl: 0.96,
  webTitleWithBrowser: 0.88,
  webTitleOnly: 0.75,
  perExtraSignal: 0.01,
  max: 0.99,
} as const;

/** Desktop meeting-capable apps (target slugs). */
export const MEETING_APPS: readonly MeetingPlatformDef[] = [
  {
    slug: "zoom",
    label: "Zoom",
    kind: "app",
    appIds: ["us.zoom.xos", "us.zoom.ZoomDaemon"],
    processNames: ["zoom.exe", "zoom", "cpt-host.exe", "zoom.us"],
    namePatterns: [/\bzoom\b/i, /zoom meeting/i, /zoom workplace/i],
  },
  {
    slug: "slack",
    label: "Slack",
    kind: "app",
    appIds: ["com.tinyspeck.slackmacgap"],
    processNames: ["slack.exe", "slack"],
    namePatterns: [/\bslack\b/i, /slack huddle/i],
    titleConfidence: 0.6,
  },
  {
    slug: "webex",
    label: "Webex",
    kind: "app",
    appIds: ["com.cisco.webexmeetingsapp", "com.cisco.WBXMeeting", "com.cisco.webex"],
    processNames: ["webexmta.exe", "webex.exe", "atmgr.exe", "ciscowebexstart.exe"],
    namePatterns: [/\bwebex\b/i, /webex meetings/i],
  },
  {
    slug: "microsoft_teams",
    label: "Microsoft Teams",
    kind: "app",
    appIds: ["com.microsoft.teams", "com.microsoft.teams2"],
    processNames: ["ms-teams.exe", "teams.exe", "msteams.exe", "teams"],
    namePatterns: [/microsoft teams/i, /\bms teams\b/i, /^teams\b/i],
  },
  {
    slug: "whatsapp",
    label: "WhatsApp",
    kind: "app",
    appIds: ["net.whatsapp.WhatsApp", "net.whatsapp.WhatsAppSMB", "desktop.whatsapp"],
    processNames: ["whatsapp.exe", "whatsapp"],
    namePatterns: [/\bwhatsapp\b/i, /whatsapp call/i],
    titleConfidence: 0.6,
  },
  {
    slug: "lark",
    label: "Lark / Feishu",
    kind: "app",
    appIds: ["com.electron.lark", "com.larksuite.lark", "com.bytedance.feishu"],
    processNames: ["lark.exe", "feishu.exe", "lark", "feishu"],
    namePatterns: [/\blark\b/i, /\bfeishu\b/i, /飞书/],
  },
  {
    slug: "amazon_chime",
    label: "Amazon Chime",
    kind: "app",
    appIds: ["com.amazon.Amazon-Chime", "com.amazon.chime"],
    processNames: ["chime.exe", "amazonchime.exe", "chime"],
    namePatterns: [/amazon chime/i, /\bchime\b/i],
  },
  {
    slug: "discord",
    label: "Discord",
    kind: "app",
    appIds: ["com.hnc.Discord", "com.discordapp.Discord"],
    processNames: ["discord.exe", "discord", "discordptb.exe", "discordcanary.exe"],
    namePatterns: [/\bdiscord\b/i],
    titleConfidence: 0.6,
  },
];

/** Browser-hosted meeting variants (browser tab / web app). */
export const MEETING_WEB_VARIANTS: readonly MeetingPlatformDef[] = [
  {
    slug: "google_meet",
    label: "Google Meet",
    kind: "web",
    titlePatterns: [/\bgoogle meet\b/i, /^meet\s*[-–—]/i, /meet\.google\.com/i],
    urlPatterns: [/meet\.google\.com/i],
  },
  {
    slug: "zoom_web",
    label: "Zoom (web)",
    kind: "web",
    titlePatterns: [/\bzoom\b/i, /zoom meeting/i, /zoom workplace/i],
    urlPatterns: [/zoom\.us\/(wc|j|my|s)\b/i, /app\.zoom\.us/i],
  },
  {
    slug: "microsoft_teams_web",
    label: "Microsoft Teams (web)",
    kind: "web",
    titlePatterns: [/microsoft teams/i, /teams\.microsoft\.com/i, /teams\.live\.com/i],
    urlPatterns: [/teams\.microsoft\.com/i, /teams\.live\.com/i],
  },
];

/** Browsers that can host the web variants above. */
export const BROWSERS: readonly MeetingPlatformDef[] = [
  {
    slug: "chrome",
    label: "Google Chrome",
    kind: "browser",
    appIds: ["com.google.chrome", "com.google.chrome.canary"],
    processNames: ["chrome.exe", "google chrome", "chrome"],
    titlePatterns: [/google chrome/i, /\bchrome\b/i],
  },
  {
    slug: "firefox",
    label: "Mozilla Firefox",
    kind: "browser",
    appIds: ["org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition"],
    processNames: ["firefox.exe", "firefox"],
    titlePatterns: [/mozilla firefox/i, /\bfirefox\b/i],
  },
  {
    slug: "safari",
    label: "Safari",
    kind: "browser",
    appIds: ["com.apple.safari", "com.apple.safaritechnologypreview"],
    processNames: ["safari.exe", "safari"],
    titlePatterns: [/\bsafari\b/i],
  },
  {
    slug: "edge",
    label: "Microsoft Edge",
    kind: "browser",
    appIds: ["com.microsoft.edgemac", "com.microsoft.edgemac.beta"],
    processNames: ["msedge.exe", "microsoft edge"],
    titlePatterns: [/microsoft.?edge/i, /\bedge\b/i],
  },
  {
    slug: "arc",
    label: "Arc",
    kind: "browser",
    appIds: ["company.thebrowser.Browser", "company.thebrowser.arc"],
    processNames: ["arc.exe", "arc"],
    titlePatterns: [/\barc\b/i],
  },
  {
    slug: "brave",
    label: "Brave",
    kind: "browser",
    appIds: ["com.brave.Browser", "com.brave.browser.beta"],
    processNames: ["brave.exe", "brave browser", "brave"],
    titlePatterns: [/\bbrave\b/i],
  },
  {
    slug: "opera",
    label: "Opera",
    kind: "browser",
    appIds: ["com.operasoftware.Opera", "com.operasoftware.OperaGX"],
    processNames: ["opera.exe", "opera"],
    titlePatterns: [/\bopera\b/i],
  },
];

const ALL_PLATFORMS: readonly MeetingPlatformDef[] = [
  ...MEETING_APPS,
  ...MEETING_WEB_VARIANTS,
  ...BROWSERS,
];

const PLATFORM_BY_SLUG = new Map(ALL_PLATFORMS.map((platform) => [platform.slug, platform]));

/** All 18 platform slugs in table order (8 apps + 3 web variants + 7 browsers). */
export const MEETING_PLATFORM_SLUGS: readonly string[] = ALL_PLATFORMS.map((p) => p.slug);

export function getMeetingPlatform(slug: string): MeetingPlatformDef | undefined {
  return PLATFORM_BY_SLUG.get(slug);
}

/** True for the meeting-capable desktop apps (not web variants, not browsers). */
export function isAllowedMeetingApp(slug: string): boolean {
  return MEETING_APPS.some((platform) => platform.slug === slug);
}

/** True when the platform is a browser-hosted meeting variant. */
export function isBrowserMeetingApp(slug: string): boolean {
  return MEETING_WEB_VARIANTS.some((platform) => platform.slug === slug);
}

function normalizeProcessName(value: string): string {
  return value.trim().toLowerCase().replace(/\.exe$/, "");
}

function normalizeBundleId(value: string): string {
  return value.trim().toLowerCase();
}

function matchProcess(platform: MeetingPlatformDef, processName: string): boolean {
  // Windows reports either "Zoom.exe" or "Zoom"; strip the suffix on both sides
  // so the table can list a single spelling.
  const normalized = normalizeProcessName(processName);
  return (platform.processNames ?? []).some(
    (candidate) => normalizeProcessName(candidate) === normalized,
  );
}

function matchBundle(platform: MeetingPlatformDef, bundleId: string): boolean {
  const normalized = normalizeBundleId(bundleId);
  return (platform.appIds ?? []).some(
    (candidate) => candidate.toLowerCase() === normalized,
  );
}

function matchAny(patterns: readonly RegExp[] | undefined, value: string | undefined): boolean {
  if (!value) return false;
  return (patterns ?? []).some((pattern) => pattern.test(value));
}

/** Identifies the browser a snapshot belongs to, if any. */
export function detectBrowser(signal: MeetingSignal): MeetingPlatformDef | undefined {
  return BROWSERS.find(
    (browser) =>
      (signal.macBundleId && matchBundle(browser, signal.macBundleId)) ||
      (signal.windowsProcessName && matchProcess(browser, signal.windowsProcessName)) ||
      matchAny(browser.titlePatterns, signal.windowTitle),
  );
}

function scoreApp(
  platform: MeetingPlatformDef,
  signal: MeetingSignal,
  browserDetected: boolean,
): { confidence: number; matchedSignals: MeetingSignalKind[] } | null {
  const matchedSignals: MeetingSignalKind[] = [];
  let confidence = 0;

  if (signal.macBundleId && matchBundle(platform, signal.macBundleId)) {
    matchedSignals.push("bundleId");
    confidence = Math.max(confidence, CONFIDENCE.appBundleId);
  }
  if (signal.windowsProcessName && matchProcess(platform, signal.windowsProcessName)) {
    matchedSignals.push("processName");
    confidence = Math.max(confidence, CONFIDENCE.appProcessName);
  }
  if (matchAny(platform.namePatterns, signal.windowTitle)) {
    matchedSignals.push("windowTitle");
    // A browser tab titled "Zoom" is the WEB variant, not the desktop app.
    if (!browserDetected) {
      confidence = Math.max(confidence, platform.titleConfidence ?? CONFIDENCE.appTitleOnly);
    }
  }

  if (matchedSignals.length === 0) return null;
  if (confidence === 0) return null;
  return { confidence, matchedSignals };
}

function scoreWebVariant(
  platform: MeetingPlatformDef,
  signal: MeetingSignal,
  browserDetected: boolean,
): { confidence: number; matchedSignals: MeetingSignalKind[] } | null {
  const matchedSignals: MeetingSignalKind[] = [];
  let confidence = 0;

  if (matchAny(platform.urlPatterns, signal.url)) {
    matchedSignals.push("url");
    confidence = Math.max(confidence, CONFIDENCE.webUrl);
  }
  if (matchAny(platform.titlePatterns, signal.windowTitle)) {
    matchedSignals.push("windowTitle");
    confidence = Math.max(
      confidence,
      browserDetected ? CONFIDENCE.webTitleWithBrowser : CONFIDENCE.webTitleOnly,
    );
  }

  if (matchedSignals.length === 0) return null;
  return { confidence, matchedSignals };
}

function withConfidenceBoost(
  confidence: number,
  matchedSignals: readonly MeetingSignalKind[],
): number {
  const extra = Math.max(0, matchedSignals.length - 1) * CONFIDENCE.perExtraSignal;
  return Math.min(CONFIDENCE.max, Math.round((confidence + extra) * 100) / 100);
}

/**
 * Pure 3-signal meeting detector. Returns the most confident meeting platform,
 * or null when no known meeting app/tab matches. Browser-only snapshots return
 * null (a browser is not a meeting).
 */
export function detectMeeting(signal: MeetingSignal): MeetingDetection | null {
  const browser = detectBrowser(signal);
  const browserSlug = browser?.slug;
  const browserDetected = !!browser;

  const candidates: {
    platform: MeetingPlatformDef;
    confidence: number;
    matchedSignals: MeetingSignalKind[];
  }[] = [];

  // Apps: bundle/process are authoritative. Title-only matches are demoted for
  // browsers because browsers are also matched by their own title patterns.
  for (const platform of MEETING_APPS) {
    const scored = scoreApp(platform, signal, browserDetected);
    if (scored) candidates.push({ platform, ...scored });
  }

  // Web variants: only meaningful when the window is a browser tab, or a URL is
  // available (browser extension / webview reporting the tab URL).
  const webVariantAllowed = browserDetected || !!signal.url;
  if (webVariantAllowed) {
    for (const platform of MEETING_WEB_VARIANTS) {
      const scored = scoreWebVariant(platform, signal, browserDetected);
      if (scored) candidates.push({ platform, ...scored });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // Tie-break: exact process/bundle proof beats title proof.
    const aStrong = a.matchedSignals.some((s) => s !== "windowTitle") ? 1 : 0;
    const bStrong = b.matchedSignals.some((s) => s !== "windowTitle") ? 1 : 0;
    return bStrong - aStrong;
  });

  const best = candidates[0]!;
  const detection: MeetingDetection = {
    slug: best.platform.slug,
    label: best.platform.label,
    kind: best.platform.kind === "web" ? "web" : "app",
    confidence: withConfidenceBoost(best.confidence, best.matchedSignals),
    matchedSignals: best.matchedSignals,
    isBrowserMeeting: best.platform.kind === "web",
    ...(best.platform.kind === "web" && browserSlug ? { browserSlug } : {}),
  };
  return detection;
}

/** Convenience: just the platform slug, matching the target's helper name. */
export function getMeetingAppSlug(signal: MeetingSignal): string | null {
  return detectMeeting(signal)?.slug ?? null;
}

/** Prompt copy shown when a meeting is detected. */
export function buildMeetingPrompt(detection: MeetingDetection): string {
  return `${detection.label} meeting detected — start HireShade for this call?`;
}
