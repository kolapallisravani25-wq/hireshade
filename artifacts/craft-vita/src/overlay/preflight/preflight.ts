/**
 * S3 runtime pre-flight evaluator (EXT G-053).
 *
 * Pure function: displays + overlay state + curated app matches + user report +
 * compatibility mode -> exactly ONE verdict: GREEN, AMBER or RED, with ordered
 * one-click actions and honest copy.
 *
 * Honest boundary: HireShade cannot observe which capture path the meeting app
 * uses (DXGI vs WGC vs GDI vs browser capture). Risk comes from the versioned
 * tested-app data list (capture-path KNOWLEDGE), never from runtime detection.
 */
import { makeAction } from './actions';
import {
  detectKnownIgnoringCapturePath,
  highestRisk,
  resolveDetectedApps,
} from './appDetection';
import {
  TESTED_APPS,
  TESTED_APPS_LIST_VERSION,
  TESTED_APPS_TESTED_ON,
} from './testedApps.data';
import type {
  AffinityMode,
  PreflightActionId,
  PreflightDisplay,
  PreflightInput,
  PreflightPresetId,
  PreflightStatus,
  PreflightVerdict,
  UserVisibilityReport,
} from './types';

export const PREFLIGHT_STATUSES: readonly PreflightStatus[] = ['GREEN', 'AMBER', 'RED'];

export const HONEST_DETECTION_COPY =
  "We can't reliably detect which capture path an app uses, so this is guidance from tested setups, not a guarantee. Confirm with the self-check on the call.";

export const SINGLE_DISPLAY_COPY =
  'Single display: keep HireShade compact, or share a window/tab instead of the whole screen.';

export const DEFAULT_MONITOR_COPY =
  'Put HireShade on monitor 2 - recommended whenever a second display exists, because a full-screen share of the meeting display cannot contain it.';

/**
 * Black box (WDA_MONITOR / 0x01) is a TARGETED mitigation, never an upgrade.
 * Copy must always state the cost on paths that already worked.
 */
export const BLACK_BOX_COST_COPY =
  'Black box mode is an OPTIONAL concealment fallback, not load-bearing: X1 measured WDA_EXCLUDEFROMCAPTURE as hidden on DXGI in 20/20 marker runs on this software-composited host, so it is not required there. On GPU-composited capture (unverified here) it may help, but paths that already hid the overlay (GDI, PrintWindow, desktopCapturer) then show a discoverable black band.';

export const BLACK_BOX_JUSTIFIED_COPY =
  'Known-DXGI/high-risk single-display setup: black box mode can stop the answer text leaking, at the cost of a discoverable black rectangle.';

export const BLACK_BOX_UNDO_COPY =
  'No known-DXGI/high-risk single-display setup was detected for this session, so black box mode is not targeted at anything here. Switching back restores invisibility on paths that already worked.';

function sanitizeDisplays(displays: readonly PreflightDisplay[] | null | undefined): PreflightDisplay[] {
  if (!Array.isArray(displays)) return [];
  return displays.filter(
    (display) =>
      display &&
      Number.isFinite(display.id) &&
      display.bounds &&
      Number.isFinite(display.bounds.x) &&
      Number.isFinite(display.bounds.y) &&
      display.bounds.width > 0 &&
      display.bounds.height > 0,
  );
}

function pickSecondary(displays: readonly PreflightDisplay[]): PreflightDisplay | null {
  const secondary = displays.filter((display) => display.primary !== true);
  if (secondary.length === 0) return null;
  // Prefer the largest secondary display (most likely the user's main workspace).
  return [...secondary].sort(
    (a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height,
  )[0]!;
}

function normalizeReport(value: UserVisibilityReport | undefined): UserVisibilityReport {
  return value === 'hidden' || value === 'visible' || value === 'unknown' ? value : null;
}

function actionsFor(
  status: PreflightStatus,
  ids: readonly PreflightActionId[],
) {
  const limit = status === 'AMBER' ? 1 : status === 'RED' ? 2 : 0;
  return ids.slice(0, limit).map((id, index) => makeAction(id, index + 1));
}

/** Evaluates the pre-flight verdict. Always returns exactly one status. */
export function evaluatePreflight(input: PreflightInput): PreflightVerdict {
  const appList = input.appList ?? TESTED_APPS;
  const displays = sanitizeDisplays(input.displays);
  const primary = displays.find((display) => display.primary === true) ?? displays[0] ?? null;
  const secondary = pickSecondary(displays);
  const hasSecondDisplay = secondary !== null;
  const recommendedDisplayId = secondary ? secondary.id : null;
  const overlayDisplayId =
    input.overlay && Number.isFinite(input.overlay.displayId)
      ? Number(input.overlay.displayId)
      : null;
  const overlayOnRecommendedDisplay =
    recommendedDisplayId !== null && overlayDisplayId === recommendedDisplayId;
  const detectedApps = resolveDetectedApps(input.detectedApps, appList);
  const captureRisk = highestRisk(detectedApps.map((app) => app.captureRisk));
  const knownIgnoringCapturePath = detectKnownIgnoringCapturePath(input.capturePathHint);
  const compatMode = input.compatMode === true;
  const report = normalizeReport(input.userReport);
  const areaRatio = Math.min(1, Math.max(0, Number(input.overlay?.areaRatio ?? 0)));
  const preset = input.overlay?.preset ?? null;
  const affinityMode: AffinityMode = input.affinityMode === 'monitor' ? 'monitor' : 'exclude';
  // Black box may be OFFERED only for a known-ignoring path / high-risk app on a
  // single display, and never when the user already verified the overlay hidden.
  const blackBoxJustified = !hasSecondDisplay && (knownIgnoringCapturePath || captureRisk === 'high');
  const blackBoxEligible = affinityMode === 'exclude' && report !== 'hidden' && blackBoxJustified;
  const recommendedPresetId: PreflightPresetId | null =
    affinityMode === 'monitor' && preset !== 'card' ? 'card' : null;
  const presetRecommendationCopy = recommendedPresetId
    ? ' Black box mode is on: switch to COMPACT so the black band reads as a small docked panel, not a full-width slab.'
    : '';

  if (displays.length === 0) {
    const facts = {
      displayCount: 0,
      hasSecondDisplay: false,
      recommendedDisplayId: null,
      overlayDisplayId,
      overlayOnRecommendedDisplay: false,
      detectedAppIds: detectedApps.map((app) => app.id),
      highestCaptureRisk: captureRisk,
      compatMode,
      knownIgnoringCapturePath,
      userReport: report,
      affinityMode,
      blackBoxEligible,
      blackBoxJustified,
      appListVersion: TESTED_APPS_LIST_VERSION,
      appListTestedOn: TESTED_APPS_TESTED_ON,
    };
    return {
      status: 'AMBER',
      headline: 'Check your display setup',
      message: 'HireShade could not read your displays. Run the self-check before the call.',
      why: ['No displays were reported by the desktop shell.'],
      honestNote: HONEST_DETECTION_COPY,
      actions: actionsFor('AMBER', ['run-self-check']),
      recommendation: {
        moveOverlayToDisplayId: null,
        isDefaultRecommendation: false,
        recommendedPresetId,
        copy: SINGLE_DISPLAY_COPY + presetRecommendationCopy,
      },
      facts,
    };
  }

  const why: string[] = [
    displays.length + ' display' + (displays.length === 1 ? '' : 's') + ' detected' +
      (hasSecondDisplay ? ' (second display available)' : ''),
  ];
  if (detectedApps.length > 0) {
    why.push(
      'Detected ' +
        detectedApps.map((app) => app.label).join(', ') +
        ' - likely capture path risk: ' +
        captureRisk +
        ' (knowledge-based, not runtime detection)',
    );
  } else {
    why.push('No curated meeting app detected (this does not tell us which capture path is in use).');
  }
  if (report === 'visible') why.push('You reported the overlay is visible in the capture.');
  if (report === 'hidden') why.push('You confirmed the overlay was hidden in the last self-check.');
  if (compatMode) why.push('Compatibility mode is ON.');
  if (knownIgnoringCapturePath) {
    why.push('Diagnostics hint names a capture path known to ignore window exclusion (' + String(input.capturePathHint) + ').');
  }
  if (preset) why.push('Overlay preset: ' + preset + (areaRatio > 0 ? ' (' + Math.round(areaRatio * 100) + '% of the work area)' : ''));

  const facts = {
    displayCount: displays.length,
    hasSecondDisplay,
    recommendedDisplayId,
    overlayDisplayId,
    overlayOnRecommendedDisplay,
    detectedAppIds: detectedApps.map((app) => app.id),
    highestCaptureRisk: captureRisk,
    compatMode,
    knownIgnoringCapturePath,
    userReport: report,
    affinityMode,
    blackBoxEligible,
    blackBoxJustified,
    appListVersion: TESTED_APPS_LIST_VERSION,
    appListTestedOn: TESTED_APPS_TESTED_ON,
  };

  const recommendation = {
    moveOverlayToDisplayId: recommendedDisplayId,
    isDefaultRecommendation: hasSecondDisplay,
    recommendedPresetId,
    copy: (hasSecondDisplay ? DEFAULT_MONITOR_COPY : SINGLE_DISPLAY_COPY) + presetRecommendationCopy,
  };

  // Black box mode is ON: it is a targeted mitigation, so either keep it only
  // where the setup justifies it (and shrink the band), or offer the undo.
  if (affinityMode === 'monitor') {
    why.push('Black box mode (WDA_MONITOR / 0x01) is ON - a targeted mitigation, not an upgrade.');
    const presetActionIds: PreflightActionId[] = preset !== 'card' ? ['switch-to-compact'] : [];
    let blackBoxStatus: PreflightStatus;
    let blackBoxHeadline: string;
    let blackBoxMessage: string;
    let blackBoxActionIds: PreflightActionId[];
    if (report === 'visible') {
      blackBoxStatus = 'RED';
      blackBoxHeadline = 'Black box mode did not hide it';
      blackBoxMessage =
        'You still saw the overlay with black box mode on, so this setup needs a window/tab share instead. ' +
        BLACK_BOX_COST_COPY;
      blackBoxActionIds = ['window-share-guidance', 'switch-back-to-invisible'];
    } else if (blackBoxJustified) {
      why.push(BLACK_BOX_JUSTIFIED_COPY);
      if (preset !== 'card') {
        blackBoxStatus = 'AMBER';
        blackBoxHeadline = 'Shrink the black band';
        blackBoxMessage =
          'Black box mode is justified for this single-display/DXGI-risk setup, but a full-width band is a big black slab. ' +
          'Switch to COMPACT so the black band reads as a small docked panel. ' +
          BLACK_BOX_COST_COPY;
        blackBoxActionIds = ['switch-to-compact'];
      } else {
        blackBoxStatus = 'GREEN';
        blackBoxHeadline = "You're set";
        blackBoxMessage =
          'Black box mode is on for a known-DXGI/high-risk single-display setup and the overlay is COMPACT, so the black band reads as a docked panel. ' +
          BLACK_BOX_COST_COPY;
        blackBoxActionIds = [];
      }
    } else {
      blackBoxStatus = 'AMBER';
      blackBoxHeadline = 'Switch back to invisible mode';
      blackBoxMessage = BLACK_BOX_UNDO_COPY + ' ' + BLACK_BOX_COST_COPY;
      blackBoxActionIds = ['switch-back-to-invisible', ...presetActionIds];
    }
    return {
      status: blackBoxStatus,
      headline: blackBoxHeadline,
      message: blackBoxMessage,
      why,
      honestNote: HONEST_DETECTION_COPY,
      actions: blackBoxActionIds.map((id, index) => makeAction(id, index + 1)),
      recommendation,
      facts,
    };
  }

  let status: PreflightStatus;
  let headline: string;
  let message: string;
  let actionIds: PreflightActionId[];

  if (report === 'visible' || (knownIgnoringCapturePath && !hasSecondDisplay && report !== 'hidden')) {
    // Exclusion is proven or known-unusable for this setup. Do not promise hiding.
    status = 'RED';
    headline = "Don't rely on hiding for this call";
    if (hasSecondDisplay && !overlayOnRecommendedDisplay) {
      message =
        'The capture showed the overlay (or this path ignores exclusion). Move HireShade to monitor 2 AND share only a window/tab for this call.';
      actionIds = ['move-to-monitor-2', 'window-share-guidance'];
      why.push('A second display is available but the overlay is not on it yet.');
    } else {
      // Black box is offered ONLY when the setup is known-DXGI/high-risk on a
      // single display - never as the default mitigation.
      const offerBlackBox = blackBoxEligible;
      message = offerBlackBox
        ? 'Share only a window/tab for the cleanest fix. Black box mode is an optional concealment fallback (a discoverable black band/rectangle instead of your answers); X1 measured 0x11 hidden on DXGI in 20/20 marker runs on this software-composited host, so it is not load-bearing, and GPU-composited behaviour is unverified.'
        : 'Exclusion cannot be relied on for this setup. Share only the meeting window or browser tab, and run the self-check before you rely on it.';
      actionIds = offerBlackBox
        ? ['window-share-guidance', 'enable-black-box-mode']
        : ['window-share-guidance', 'run-self-check'];
      if (offerBlackBox) why.push(BLACK_BOX_COST_COPY);
    }
    if (report === 'visible' && compatMode) {
      why.push('The overlay was still visible with compatibility mode ON, so compatibility mode alone will not fix this setup.');
    }
  } else if (captureRisk === 'high' && !hasSecondDisplay && report !== 'hidden') {
    // Likely native/hardware capture path (DXGI family) and no structural escape.
    status = 'RED';
    headline = 'This setup cannot rely on window exclusion';
    const offerBlackBox = blackBoxEligible;
    message = offerBlackBox
      ? 'This app is in the DXGI-family risk list and there is only one display. Sharing a window/tab avoids the capture path entirely. ' +
        'Black box mode is an optional concealment fallback (discoverable black rectangle), not load-bearing: X1 measured 0x11 hidden on DXGI in 20/20 marker runs on this software-composited host; GPU-composited behaviour is unverified.'
      : 'This app is in the DXGI-family risk list and there is only one display. Share a window/tab and run the self-check.';
    actionIds = offerBlackBox
      ? ['window-share-guidance', 'enable-black-box-mode']
      : ['window-share-guidance', 'run-self-check'];
    if (offerBlackBox) why.push(BLACK_BOX_COST_COPY);
  } else if (hasSecondDisplay && !overlayOnRecommendedDisplay) {
    // Requirement: putting the overlay on the second display is the DEFAULT
    // recommendation whenever one exists - never a fallback.
    status = 'AMBER';
    headline = 'Move HireShade to monitor 2';
    message =
      'Keep the overlay on the other display and share only your meeting display. Full-screen shares then cannot contain it, regardless of capture path.';
    actionIds = ['move-to-monitor-2'];
  } else if (hasSecondDisplay && overlayOnRecommendedDisplay) {
    status = 'GREEN';
    headline = "You're set";
    message = 'HireShade is on monitor 2. Keep sharing only the meeting display and this setup does not depend on window exclusion.';
    actionIds = [];
  } else if (report === 'hidden') {
    status = 'GREEN';
    headline = "You're set";
    message = 'Your last self-check confirmed the overlay was hidden. Nothing to change before this call.';
    actionIds = [];
  } else {
    // Default single-display, unverified setup: exactly one thing to do - verify.
    status = 'AMBER';
    headline = 'Verify hiding before the call';
    message =
      'You have one display. Run the self-check once and confirm whether the overlay shows in the share; if it does, share a window/tab instead.';
    actionIds = ['run-self-check'];
  }

  return {
    status,
    headline,
    message,
    why,
    honestNote: HONEST_DETECTION_COPY,
    actions: actionsFor(status, actionIds),
    recommendation,
    facts,
  };
}

/** Convenience: just the status (ordering tests use the full verdict). */
export function preflightStatus(input: PreflightInput): PreflightStatus {
  return evaluatePreflight(input).status;
}
