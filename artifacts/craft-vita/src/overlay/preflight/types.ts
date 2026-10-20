/**
 * S3 runtime pre-flight types (EXT G-053).
 */
import type { CaptureRisk, TestedApp } from "./testedApps.data";

/** Exactly three verdict states. Do not add a fourth. */
export type PreflightStatus = "GREEN" | "AMBER" | "RED";

export interface PreflightDisplay {
  readonly id: number;
  readonly primary: boolean;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly scaleFactor?: number;
}

export type PreflightPresetId = "card" | "banner" | "reading";

export interface PreflightOverlayState {
  /** Display the overlay is currently on, when known. */
  readonly displayId?: number | null;
  readonly preset?: PreflightPresetId;
  readonly transparent?: boolean;
  /** Overlay area as a fraction of its display work area (0..1). */
  readonly areaRatio?: number;
}

export interface DetectedAppMatch {
  readonly appId: string;
  /** How the match was found (diagnostics only; never a capture-path claim). */
  readonly matchedBy: "process" | "title";
  readonly matchedValue: string;
}

export type UserVisibilityReport = "hidden" | "visible" | "unknown" | null;

export interface PreflightInput {
  readonly displays: readonly PreflightDisplay[];
  readonly overlay?: PreflightOverlayState | null;
  readonly detectedApps?: readonly DetectedAppMatch[];
  readonly userReport?: UserVisibilityReport;
  readonly compatMode?: boolean;
  /** Diagnostic hint from main (env/debug IPC), e.g. "dxgi-desktop-duplication". */
  readonly capturePathHint?: string | null;
  /** Tested-app list override (tests/fixtures); defaults to TESTED_APPS. */
  readonly appList?: readonly TestedApp[];
}

export type PreflightActionId =
  | "move-to-monitor-2"
  | "window-share-guidance"
  | "enable-compatibility-mode"
  | "enable-black-box-mode"
  | "run-self-check";

export interface PreflightAction {
  readonly id: PreflightActionId;
  readonly label: string;
  readonly description: string;
  /** one-click = the UI can perform it; info = guidance only. */
  readonly kind: "one-click" | "info";
  /** Ordered step number within this verdict (1-based). */
  readonly order: number;
}

export interface PreflightFacts {
  readonly displayCount: number;
  readonly hasSecondDisplay: boolean;
  readonly recommendedDisplayId: number | null;
  readonly overlayDisplayId: number | null;
  readonly overlayOnRecommendedDisplay: boolean;
  readonly detectedAppIds: readonly string[];
  readonly highestCaptureRisk: CaptureRisk;
  readonly compatMode: boolean;
  readonly knownIgnoringCapturePath: boolean;
  readonly userReport: UserVisibilityReport;
  readonly appListVersion: string;
  readonly appListTestedOn: string;
}

export interface PreflightVerdict {
  readonly status: PreflightStatus;
  readonly headline: string;
  readonly message: string;
  /** Plain-language reasons, ordered. */
  readonly why: readonly string[];
  /** Honest limitation copy (always present). */
  readonly honestNote: string;
  /** Ordered actions. AMBER: exactly one. RED: one or two. GREEN: none. */
  readonly actions: readonly PreflightAction[];
  readonly recommendation: {
    readonly moveOverlayToDisplayId: number | null;
    readonly isDefaultRecommendation: boolean;
    readonly copy: string;
  };
  readonly facts: PreflightFacts;
}

export interface PreflightHostActions {
  readonly moveOverlayToDisplay?: (displayId: number) => Promise<unknown> | unknown;
  readonly showWindowShareGuidance?: () => Promise<unknown> | unknown;
  readonly setCompatibilityMode?: (enabled: boolean) => Promise<unknown> | unknown;
  readonly setBlackBoxMode?: (enabled: boolean) => Promise<unknown> | unknown;
  readonly runSelfCheck?: (patternKind: "content-leak" | "black-bar-leak") => Promise<unknown> | unknown;
}
