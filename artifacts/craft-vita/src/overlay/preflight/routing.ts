/**
 * Action routing + Electron IPC wiring contract for pre-flight (S3).
 *
 * This module does NOT edit main.js/preload.js (stealth owns them). It defines
 * the exact channels and payloads main/preload must add; the renderer host
 * falls back to the EXISTING capture bridge for compatibility mode/self-check.
 */
import type {
  DetectedAppMatch,
  PreflightAction,
  PreflightDisplay,
  PreflightInput,
  PreflightHostActions,
  UserVisibilityReport,
} from './types';

export const PREFLIGHT_IPC = {
  /** main -> renderer invoke: displays + overlay placement + capture state. */
  getContext: 'desktop:preflight:get-context',
  /** renderer -> main invoke: { displayId } moves the live overlay window. */
  moveToDisplay: 'desktop:preflight:move-to-display',
  /** renderer -> main invoke: { pattern: 'content-leak'|'black-bar-leak' }. */
  showSelfCheck: 'desktop:preflight:show-self-check',
  /** renderer -> main event: pre-flight rendered, for analytics/logging only. */
  rendered: 'desktop:preflight:rendered',
} as const;

/** Existing capture IPC channels reused instead of duplicated. */
export const REUSED_CAPTURE_CHANNELS = {
  getState: 'desktop:capture:get-state',
  setCompatMode: 'desktop:capture:set-compat-mode',
  reportVisible: 'desktop:capture:report-visible',
  markSelfCheck: 'desktop:capture:mark-self-check',
  assertNow: 'desktop:capture:assert-now',
} as const;

/** Shape returned by desktop:preflight:get-context (main.js). */
export interface ElectronPreflightContext {
  readonly displays: readonly PreflightDisplay[];
  readonly overlayBounds?: { x: number; y: number; width: number; height: number } | null;
  readonly overlayDisplayId?: number | null;
  readonly captureState?: {
    readonly lastProfile?: string;
    readonly compatMode?: boolean;
    readonly reportedVisible?: boolean;
    readonly lastSelfCheckAt?: number | null;
    readonly knownBadCapturePath?: string | null;
    readonly overlayAreaRatio?: number;
  } | null;
  readonly detectedApps?: readonly DetectedAppMatch[];
  readonly processName?: string | null;
  readonly windowTitle?: string | null;
}

function displayForBounds(
  bounds: { x: number; y: number; width: number; height: number },
  displays: readonly PreflightDisplay[],
): number | null {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  for (const display of displays) {
    const b = display.bounds;
    if (cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) {
      return display.id;
    }
  }
  return null;
}

/** Maps the Electron context payload into the pure pre-flight input. */
export function contextToPreflightInput(
  context: ElectronPreflightContext,
  overrides: Partial<Pick<PreflightInput, 'userReport' | 'detectedApps' | 'appList'>> = {},
): PreflightInput {
  const displays = Array.isArray(context.displays) ? context.displays : [];
  const capture = context.captureState ?? {};
  const overlayDisplayId =
    context.overlayDisplayId ??
    (context.overlayBounds ? displayForBounds(context.overlayBounds, displays) : null);
  const reportedVisible = capture.reportedVisible === true;
  const userReport: UserVisibilityReport =
    overrides.userReport !== undefined
      ? overrides.userReport
      : reportedVisible
        ? 'visible'
        : capture.lastSelfCheckAt && capture.reportedVisible === false
          ? 'hidden'
          : null;
  return {
    displays,
    overlay: {
      displayId: overlayDisplayId,
      preset:
        capture.lastProfile === 'banner' ||
        capture.lastProfile === 'reading' ||
        capture.lastProfile === 'card'
          ? capture.lastProfile
          : undefined,
      transparent: capture.compatMode !== true,
      areaRatio: Number.isFinite(capture.overlayAreaRatio)
        ? Number(capture.overlayAreaRatio)
        : 0,
    },
    detectedApps: overrides.detectedApps,
    userReport,
    compatMode: capture.compatMode === true,
    capturePathHint: capture.knownBadCapturePath ?? null,
    ...(overrides.appList ? { appList: overrides.appList } : {}),
  };
}

export interface RoutedActionResult {
  readonly actionId: PreflightAction['id'];
  readonly handled: boolean;
  readonly message: string;
}

/**
 * Routes one verdict action to the host. Never throws: a missing/failed host
 * action returns handled:false with a plain-language reason so the UI can show
 * guidance instead of dying.
 */
export async function routePreflightAction(
  action: PreflightAction,
  host: PreflightHostActions | null | undefined,
  context: { readonly moveOverlayToDisplayId?: number | null } = {},
): Promise<RoutedActionResult> {
  const safeHost = host ?? {};
  try {
    switch (action.id) {
      case 'move-to-monitor-2': {
        const displayId = context.moveOverlayToDisplayId;
        if (displayId === null || displayId === undefined) {
          return {
            actionId: action.id,
            handled: false,
            message: 'No second display is available to move to.',
          };
        }
        if (!safeHost.moveOverlayToDisplay) {
          return {
            actionId: action.id,
            handled: false,
            message: 'Move to display is not wired yet; drag HireShade to monitor 2 manually.',
          };
        }
        await safeHost.moveOverlayToDisplay(displayId);
        return { actionId: action.id, handled: true, message: 'Moved HireShade to monitor 2.' };
      }
      case 'window-share-guidance': {
        if (safeHost.showWindowShareGuidance) await safeHost.showWindowShareGuidance();
        return {
          actionId: action.id,
          handled: true,
          message: 'Share only the meeting window or browser tab, not the entire screen.',
        };
      }
      case 'enable-black-box-mode': {
        if (!safeHost.setBlackBoxMode) {
          return {
            actionId: action.id,
            handled: false,
            message: 'Black box mode is not wired to this shell yet.',
          };
        }
        await safeHost.setBlackBoxMode(true);
        return {
          actionId: action.id,
          handled: true,
          message: 'Black box mode enabled: capture paths that ignore exclusion will see a black rectangle instead of your answers.',
        };
      }
      case 'enable-compatibility-mode': {
        if (!safeHost.setCompatibilityMode) {
          return {
            actionId: action.id,
            handled: false,
            message: 'Compatibility mode is not available in this build.',
          };
        }
        await safeHost.setCompatibilityMode(true);
        return { actionId: action.id, handled: true, message: 'Compatibility mode enabled.' };
      }
      case 'run-self-check': {
        if (!safeHost.runSelfCheck) {
          return {
            actionId: action.id,
            handled: false,
            message: 'The self-check is not wired to the overlay yet; ask the other person to confirm visibility.',
          };
        }
        await safeHost.runSelfCheck('black-bar-leak');
        return { actionId: action.id, handled: true, message: 'Self-check pattern shown.' };
      }
      default:
        return { actionId: action.id, handled: false, message: 'Unknown action.' };
    }
  } catch (error) {
    return {
      actionId: action.id,
      handled: false,
      message: 'Action failed: ' + (error instanceof Error ? error.message : String(error)),
    };
  }
}

/**
 * Renderer host built from the preload bridges O2 exposes today:
 *   window.hireshadePreflight (new, see PREFLIGHT_IPC)
 *   window.hireshadeCapture   (existing: setCompatMode, markSelfCheck, getState)
 * A missing bridge degrades to guidance instead of throwing.
 */
export interface RendererBridgeLike {
  readonly hireshadePreflight?: {
    getContext?: () => Promise<ElectronPreflightContext>;
    moveToDisplay?: (displayId: number) => Promise<unknown>;
    showSelfCheck?: (pattern: 'content-leak' | 'black-bar-leak') => Promise<unknown>;
  };
  readonly hireshadeCapture?: {
    setCompatMode?: (enabled: boolean) => Promise<unknown>;
    setAffinityMode?: (mode: 'monitor' | 'exclude') => Promise<unknown>;
    markSelfCheck?: () => Promise<unknown>;
    reportVisible?: (visible: boolean) => Promise<unknown>;
  };
}

export function createRendererPreflightHost(
  bridge: RendererBridgeLike | null | undefined,
): PreflightHostActions {
  const preflight = bridge?.hireshadePreflight;
  const capture = bridge?.hireshadeCapture;
  return {
    moveOverlayToDisplay: preflight?.moveToDisplay
      ? (displayId) => preflight.moveToDisplay!(displayId)
      : undefined,
    showWindowShareGuidance: () => undefined,
    setCompatibilityMode: capture?.setCompatMode
      ? (enabled) => capture.setCompatMode!(enabled)
      : undefined,
    setBlackBoxMode: capture?.setAffinityMode
      ? (enabled) => capture.setAffinityMode!(enabled ? 'monitor' : 'exclude')
      : undefined,
    runSelfCheck: preflight?.showSelfCheck
      ? (pattern) => preflight.showSelfCheck!(pattern)
      : capture?.markSelfCheck
        ? () => capture.markSelfCheck!()
        : undefined,
  };
}
