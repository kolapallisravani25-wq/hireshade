"use strict";

/**
 * O2 capture-protection logic (shared by the Electron main process, the
 * preload self-check UI and the vitest suite).
 *
 * This file is intentionally CommonJS (.cjs) so main.js/preload.js can require
 * it directly without a build step (the shell has no bundler) while tests can
 * import the same source of truth. No DOM/Electron imports here.
 */

/** Overlay size profiles exercised by the capture matrix. */
const CAPTURE_PROFILES = ["card", "banner", "reading"];

const CAPTURE_PROFILE_LABELS = {
  card: "Card (700x360, top-center)",
  banner: "Banner (full width, top)",
  reading: "Reading (near full screen, centered)",
};

const PROFILE_MARGIN = 16;
const BANNER_HEIGHT_RATIO = 0.28;
const BANNER_MIN_HEIGHT = 240;
const BANNER_MAX_HEIGHT = 420;
const READING_WIDTH_RATIO = 0.92;
const READING_HEIGHT_RATIO = 0.88;

/** Solid scrim used by compatibility mode (matches the app dark surface). */
const COMPAT_SCRIM_COLOR = "#0b0d12";

const COMPAT_CSS_CLASS = "hireshade-capture-compat";

/** High-contrast self-check phrase; the pattern itself is drawn in preload. */
const SELF_CHECK_COPY = {
  title: "Can they see it?",
  action: "Show test pattern",
  instructions:
    "Look at the shared screen on the OTHER device (or ask the person on the call). The pattern is deliberately high contrast.",
  limitation:
    "We cannot reliably detect whether a capture app is showing this window. Capture apps use different Windows APIs, and some (notably DXGI Desktop Duplication) ignore capture exclusion.",
  hiddenLabel: "It is hidden",
  visibleLabel: "I can still see it",
  visibleReported:
    "Thanks - that means this capture path is showing the overlay. Try compatibility mode, or share a window/tab instead of the whole screen.",
  hiddenReported: "Good - the overlay was not visible in the capture you checked.",
  compatSuggestion:
    "Compatibility mode recreates the overlay as an opaque surface with a solid scrim (no transparency, blur or rounded compositing). It is more reliable in capture apps that ignore per-window exclusion.",
  noReliableDetection:
    "Capture visibility cannot be reliably detected automatically. This check is manual on purpose.",
};

/**
 * Fallback ladder, plain language, in order. step 1 is the least invasive.
 */
const FALLBACK_LADDER = [
  {
    step: 1,
    id: "second-monitor",
    addresses: "DXGI/whole-screen capture that ignores WDA_EXCLUDEFROMCAPTURE",
    title: "Use a second monitor for the meeting",
    detail:
      "Fixes the case where the interviewer's app captures with DXGI Desktop Duplication (it ignores the exclusion flag). Share the meeting app's screen on the OTHER monitor and keep HireShade on this one; a full-screen share of the other monitor cannot contain the overlay.",
  },
  {
    step: 2,
    id: "share-window-or-tab",
    addresses: "whole-screen capture that ignores exclusion, without a second monitor",
    title: "Share a window or browser tab instead of the entire screen",
    detail:
      "Fixes the same DXGI/whole-screen leak when you only have one monitor. Window/tab shares capture only that surface, so another app window cannot appear in the capture.",
  },
  {
    step: 3,
    id: "compatibility-mode",
    addresses: "black rectangle / black bar in PrintWindow or transparent-compositing capture",
    title: "Turn on compatibility mode",
    detail:
      "Fixes the black-bar symptom (a transparent protected surface printing as black) by using an opaque surface + solid colour scrim with no blur or rounded compositing. It does NOT fix DXGI Desktop Duplication - use monitor 2 or window/tab share for that.",
  },
  {
    step: 4,
    id: "browser-only",
    addresses: "all desktop-window capture paths, at the cost of overlay ergonomics",
    title: "Use the browser-only overlay",
    detail:
      "Last resort for any desktop capture path. Open the web app in a normal browser window instead of the desktop overlay; no per-window exclusion is claimed in that mode, so keep the browser window off the shared screen.",
  },
];

const CAPTURE_STATE_VERSION = 1;

const DEFAULT_CAPTURE_STATE = {
  version: CAPTURE_STATE_VERSION,
  compatMode: false,
  lastProfile: "card",
  lastProfileBounds: null,
  reportedVisible: false,
  lastSelfCheckAt: null,
  lastSuggestion: null,
  knownBadCapturePath: null,
};

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isCaptureProfile(value) {
  return typeof value === "string" && CAPTURE_PROFILES.indexOf(value) >= 0;
}

function normalizeCaptureProfile(value) {
  return isCaptureProfile(value) ? value : "card";
}

function isValidWorkArea(area) {
  return (
    area &&
    isFiniteNumber(area.x) &&
    isFiniteNumber(area.y) &&
    isFiniteNumber(area.width) &&
    isFiniteNumber(area.height) &&
    area.width > 0 &&
    area.height > 0
  );
}

/**
 * Compute the window bounds for a capture profile inside a display work area.
 * All values are device-independent pixels, matching Electron's screen API.
 */
function computeCaptureLayout(profile, workArea, options) {
  if (!isValidWorkArea(workArea)) {
    throw new Error("computeCaptureLayout: invalid work area");
  }
  const safeProfile = normalizeCaptureProfile(profile);
  const margin = options && isFiniteNumber(options.margin) ? Math.max(0, options.margin) : PROFILE_MARGIN;
  const area = workArea;
  if (safeProfile === "banner") {
    const height = Math.round(
      clamp(area.height * BANNER_HEIGHT_RATIO, BANNER_MIN_HEIGHT, Math.min(BANNER_MAX_HEIGHT, area.height)),
    );
    return { x: area.x, y: area.y + margin, width: area.width, height: height };
  }
  if (safeProfile === "reading") {
    const width = Math.round(area.width * READING_WIDTH_RATIO);
    const height = Math.round(area.height * READING_HEIGHT_RATIO);
    return {
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round((area.height - height) / 2),
      width,
      height,
    };
  }
  const width = Math.min(700, area.width);
  const height = Math.min(360, area.height);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + margin,
    width,
    height,
  };
}

/** Compatibility-mode surface plan (opaque + solid scrim, no blur/rounding). */
function computeCompatPlan(enabled) {
  if (!enabled) {
    return {
      enabled: false,
      transparent: true,
      backgroundColor: "#00000000",
      cssClass: null,
      requiresSurfaceRecreate: false,
      disableBackdropFilter: false,
      disableRoundedCorners: false,
      disableShadows: false,
    };
  }
  return {
    enabled: true,
    transparent: false,
    backgroundColor: COMPAT_SCRIM_COLOR,
    cssClass: COMPAT_CSS_CLASS,
    requiresSurfaceRecreate: true,
    disableBackdropFilter: true,
    disableRoundedCorners: true,
    disableShadows: true,
  };
}

/** CSS injected by preload when compatibility mode is on. */
const COMPAT_CSS =
  "html." +
  COMPAT_CSS_CLASS +
  ",html." +
  COMPAT_CSS_CLASS +
  " body{background:" +
  COMPAT_SCRIM_COLOR +
  " !important;background-image:none !important;}" +
  "html." +
  COMPAT_CSS_CLASS +
  " *{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;filter:none !important;" +
  "border-radius:0 !important;box-shadow:none !important;text-shadow:none !important;}";

/**
 * Best-effort suggestion for compatibility mode. Honest: the only reliable
 * signal is the user's own report; the large-transparent heuristic is labelled
 * as such and a known-bad capture path can be supplied by a caller/diagnostic.
 */
function suggestCompatibilityMode(input) {
  const options = input || {};
  const reasons = [];
  let confidence = "none";
  if (options.reportedVisible) {
    reasons.push("user reports the overlay is visible in the capture");
    confidence = "reported";
  }
  const areaRatio =
    isFiniteNumber(options.overlayAreaRatio) && options.overlayAreaRatio >= 0 && options.overlayAreaRatio <= 1
      ? options.overlayAreaRatio
      : 0;
  if (areaRatio >= 0.45 && options.transparent !== false) {
    reasons.push(
      "large transparent overlay (heuristic: " + Math.round(areaRatio * 100) + "% of the work area)",
    );
    if (confidence === "none") confidence = "heuristic";
  }
  if (typeof options.knownBadCapturePath === "string" && options.knownBadCapturePath.trim()) {
    reasons.push("known-bad capture path hint: " + options.knownBadCapturePath.trim());
    if (confidence === "none" || confidence === "heuristic") confidence = "hint";
  }
  return {
    suggest: reasons.length > 0,
    reasons: reasons,
    confidence: confidence,
    honestNote: SELF_CHECK_COPY.noReliableDetection,
    canAutoDetect: false,
  };
}

/** Which window events must re-assert capture exclusion. */
const REASSERT_EVENTS = [
  "show",
  "restore",
  "focus",
  "resize",
  "move",
  "preset-change",
  "profile-change",
  "display-metrics-changed",
  "display-added",
  "display-removed",
  "window-recreated",
  "private-mode-changed",
  "compat-mode-changed",
  "manual-assert",
  "pointer-pass-through",
];

function shouldReassert(event) {
  return typeof event === "string" && REASSERT_EVENTS.indexOf(event) >= 0;
}

function describeReassert(event) {
  switch (event) {
    case "display-metrics-changed":
      return "display metrics changed (DPI/scale/work area)";
    case "display-added":
      return "display added";
    case "display-removed":
      return "display removed";
    case "window-recreated":
      return "window surface recreated";
    case "compat-mode-changed":
      return "compatibility mode changed";
    default:
      return String(event);
  }
}

/** Next fallback step not yet attempted (plain-language ladder). */
function nextFallbackStep(attemptedIds) {
  const attempted = Array.isArray(attemptedIds) ? attemptedIds : [];
  for (const step of FALLBACK_LADDER) {
    if (attempted.indexOf(step.id) === -1) return step;
  }
  return null;
}

function isRect(value) {
  return (
    value &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function parseCaptureState(raw) {
  const base = Object.assign({}, DEFAULT_CAPTURE_STATE);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  return {
    version: CAPTURE_STATE_VERSION,
    compatMode: raw.compatMode === true,
    lastProfile: isCaptureProfile(raw.lastProfile) ? raw.lastProfile : base.lastProfile,
    lastProfileBounds: isRect(raw.lastProfileBounds)
      ? {
          x: Math.round(raw.lastProfileBounds.x),
          y: Math.round(raw.lastProfileBounds.y),
          width: Math.round(raw.lastProfileBounds.width),
          height: Math.round(raw.lastProfileBounds.height),
        }
      : null,
    reportedVisible: raw.reportedVisible === true,
    lastSelfCheckAt: isFiniteNumber(raw.lastSelfCheckAt) ? raw.lastSelfCheckAt : null,
    lastSuggestion:
      raw.lastSuggestion && typeof raw.lastSuggestion === "object" && !Array.isArray(raw.lastSuggestion)
        ? raw.lastSuggestion
        : null,
    knownBadCapturePath:
      typeof raw.knownBadCapturePath === "string" && raw.knownBadCapturePath.trim()
        ? raw.knownBadCapturePath.trim()
        : null,
  };
}

function serializeCaptureState(state) {
  return JSON.stringify(parseCaptureState(state), null, 2) + "\n";
}

function setCompatMode(state, enabled) {
  return Object.assign({}, parseCaptureState(state), { compatMode: enabled === true });
}

function setCaptureProfile(state, profile, bounds) {
  const parsed = parseCaptureState(state);
  return Object.assign({}, parsed, {
    lastProfile: normalizeCaptureProfile(profile),
    lastProfileBounds: isRect(bounds) ? bounds : parsed.lastProfileBounds,
  });
}

function recordSelfCheck(state, result) {
  const parsed = parseCaptureState(state);
  const reportedVisible = Boolean(result && result.reportedVisible);
  const at = result && isFiniteNumber(result.at) ? result.at : Date.now();
  const suggestion = suggestCompatibilityMode({
    reportedVisible: reportedVisible,
    overlayAreaRatio: result && result.overlayAreaRatio,
    transparent: result && result.transparent,
    knownBadCapturePath: result && result.knownBadCapturePath,
  });
  return Object.assign({}, parsed, {
    reportedVisible: reportedVisible,
    lastSelfCheckAt: at,
    lastSuggestion: suggestion.suggest ? suggestion : null,
  });
}

function setKnownBadCapturePath(state, hint) {
  const parsed = parseCaptureState(state);
  const value = typeof hint === "string" && hint.trim() ? hint.trim() : null;
  return Object.assign({}, parsed, {
    knownBadCapturePath: value,
    lastSuggestion: suggestCompatibilityMode({
      reportedVisible: parsed.reportedVisible,
      knownBadCapturePath: value,
      transparent: !parsed.compatMode,
    }).suggest
      ? suggestCompatibilityMode({
          reportedVisible: parsed.reportedVisible,
          knownBadCapturePath: value,
          transparent: !parsed.compatMode,
        })
      : null,
  });
}

/** IPC channel names. Mirrored verbatim in preload.js (contract test). */
const CAPTURE_CHANNELS = {
  getState: "desktop:capture:get-state",
  setCompatMode: "desktop:capture:set-compat-mode",
  applyProfile: "desktop:capture:apply-profile",
  reportVisible: "desktop:capture:report-visible",
  markSelfCheck: "desktop:capture:mark-self-check",
  assertNow: "desktop:capture:assert-now",
  simulateDisplayChange: "desktop:capture:simulate-display-change",
  setHint: "desktop:capture:set-hint",
  stateChanged: "desktop:capture:state-changed",
  suggestion: "desktop:capture:suggestion",
};

module.exports = {
  CAPTURE_PROFILES,
  CAPTURE_PROFILE_LABELS,
  CAPTURE_CHANNELS,
  CAPTURE_STATE_VERSION,
  COMPAT_CSS,
  COMPAT_CSS_CLASS,
  COMPAT_SCRIM_COLOR,
  DEFAULT_CAPTURE_STATE,
  FALLBACK_LADDER,
  PROFILE_MARGIN,
  REASSERT_EVENTS,
  SELF_CHECK_COPY,
  clamp,
  computeCaptureLayout,
  computeCompatPlan,
  describeReassert,
  isCaptureProfile,
  isRect,
  nextFallbackStep,
  normalizeCaptureProfile,
  parseCaptureState,
  recordSelfCheck,
  serializeCaptureState,
  setCaptureProfile,
  setCompatMode,
  setKnownBadCapturePath,
  shouldReassert,
  suggestCompatibilityMode,
};
