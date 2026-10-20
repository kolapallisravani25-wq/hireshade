/**
 * Curated app detection + risk helpers for pre-flight (S3).
 * Detection is best-effort title/process matching; it is NOT capture-path
 * detection and never claims to be.
 */
import { TESTED_APPS, type CaptureRisk, type TestedApp } from './testedApps.data';
import type { DetectedAppMatch } from './types';

export interface AppSignals {
  readonly processName?: string | null;
  readonly windowTitle?: string | null;
  readonly appList?: readonly TestedApp[];
}

function normalizeProcess(value: string): string {
  return value.trim().toLowerCase().replace(/\.exe$/, '');
}

function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

/** Matches a process/title snapshot against the curated list. */
export function matchTestedApps(signals: AppSignals): DetectedAppMatch[] {
  const list = signals.appList ?? TESTED_APPS;
  const process = signals.processName ? normalizeProcess(signals.processName) : '';
  const title = (signals.windowTitle ?? '').trim();
  const matches: DetectedAppMatch[] = [];
  for (const app of list) {
    const processHit = process
      ? app.processNames.find((name) => normalizeProcess(name) === process)
      : undefined;
    if (processHit) {
      matches.push({ appId: app.id, matchedBy: 'process', matchedValue: processHit });
      continue;
    }
    if (!title) continue;
    const titleHit = app.windowTitlePatterns.map(compile).find((pattern) => pattern && pattern.test(title));
    if (titleHit) {
      matches.push({ appId: app.id, matchedBy: 'title', matchedValue: titleHit.source });
    }
  }
  return matches;
}

const RISK_ORDER: Record<CaptureRisk, number> = { unknown: 0, low: 1, medium: 2, high: 3 };

export function highestRisk(risks: readonly CaptureRisk[]): CaptureRisk {
  let best: CaptureRisk = 'unknown';
  for (const risk of risks) {
    if (RISK_ORDER[risk] > RISK_ORDER[best]) best = risk;
  }
  return best;
}

/** Apps whose likely capture path is known to ignore exclusion (DXGI family). */
export function highRiskApps(appList: readonly TestedApp[] = TESTED_APPS): readonly TestedApp[] {
  return appList.filter((app) => app.captureRisk === 'high');
}

export function resolveDetectedApps(
  matches: readonly DetectedAppMatch[] | undefined,
  appList: readonly TestedApp[] = TESTED_APPS,
): TestedApp[] {
  if (!matches || matches.length === 0) return [];
  const byId = new Map(appList.map((app) => [app.id, app]));
  const seen = new Set<string>();
  const resolved: TestedApp[] = [];
  for (const match of matches) {
    const app = byId.get(match.appId);
    if (!app || seen.has(app.id)) continue;
    seen.add(app.id);
    resolved.push(app);
  }
  return resolved;
}

/** Diagnostics hint -> does it name a capture path known to ignore exclusion? */
export const KNOWN_IGNORING_PATH_HINTS = [
  'dxgi',
  'desktop duplication',
  'ddagrab',
  'desktopduplication',
  'hardware capture',
] as const;

export function detectKnownIgnoringCapturePath(hint?: string | null): boolean {
  if (!hint) return false;
  const value = hint.toLowerCase();
  return KNOWN_IGNORING_PATH_HINTS.some((token) => value.indexOf(token) >= 0);
}
