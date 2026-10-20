import { describe, expect, it } from 'vitest';
import {
  HONEST_DETECTION_COPY,
  PREFLIGHT_STATUSES,
  evaluatePreflight,
} from './preflight';
import { PREFLIGHT_ACTION_CATALOG } from './actions';
import { matchTestedApps, detectKnownIgnoringCapturePath, highestRisk } from './appDetection';
import {
  contextToPreflightInput,
  createRendererPreflightHost,
  routePreflightAction,
} from './routing';
import type { PreflightDisplay, PreflightInput } from './types';
import { TESTED_APPS_LIST_VERSION, TESTED_APPS_TESTED_ON } from './testedApps.data';

const primary: PreflightDisplay = {
  id: 1,
  primary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
};
const secondary: PreflightDisplay = {
  id: 2,
  primary: false,
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
};

function base(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    displays: [primary],
    overlay: { displayId: 1, preset: 'banner', transparent: true, areaRatio: 0.2 },
    detectedApps: [],
    userReport: null,
    compatMode: false,
    capturePathHint: null,
    ...overrides,
  };
}

function detected(appId: string) {
  return [{ appId, matchedBy: 'process' as const, matchedValue: appId }];
}

describe('pre-flight verdict states (exactly three)', () => {
  it('exposes exactly GREEN/AMBER/RED', () => {
    expect(PREFLIGHT_STATUSES).toEqual(['GREEN', 'AMBER', 'RED']);
  });

  it('GREEN: overlay already on the second display', () => {
    const verdict = evaluatePreflight(
      base({ displays: [primary, secondary], overlay: { displayId: 2, preset: 'banner' } }),
    );
    expect(verdict.status).toBe('GREEN');
    expect(verdict.actions).toEqual([]);
    expect(verdict.headline).toContain("You're set");
    expect(verdict.recommendation.isDefaultRecommendation).toBe(true);
  });

  it('GREEN: single display, user-confirmed hidden', () => {
    const verdict = evaluatePreflight(base({ userReport: 'hidden' }));
    expect(verdict.status).toBe('GREEN');
    expect(verdict.actions).toEqual([]);
  });

  it('AMBER: second display exists but overlay is on the primary (default recommendation)', () => {
    const verdict = evaluatePreflight(base({ displays: [primary, secondary] }));
    expect(verdict.status).toBe('AMBER');
    expect(verdict.actions).toHaveLength(1);
    expect(verdict.actions[0]!.id).toBe('move-to-monitor-2');
    expect(verdict.actions[0]!.order).toBe(1);
    expect(verdict.recommendation.isDefaultRecommendation).toBe(true);
    expect(verdict.recommendation.moveOverlayToDisplayId).toBe(2);
    expect(verdict.recommendation.copy).toContain('monitor 2');
  });

  it('AMBER: second display is the default recommendation even without an app or report', () => {
    for (const report of [null, 'unknown', 'hidden'] as const) {
      const verdict = evaluatePreflight(base({ displays: [primary, secondary], userReport: report }));
      expect(verdict.status, String(report)).toBe('AMBER');
      expect(verdict.actions[0]!.id).toBe('move-to-monitor-2');
    }
  });

  it('AMBER: single display, unverified -> run self-check', () => {
    const verdict = evaluatePreflight(base());
    expect(verdict.status).toBe('AMBER');
    expect(verdict.actions).toHaveLength(1);
    expect(verdict.actions[0]!.id).toBe('run-self-check');
    expect(verdict.recommendation.isDefaultRecommendation).toBe(false);
  });

  it('AMBER: large transparent overlay on one display -> compatibility mode', () => {
    const verdict = evaluatePreflight(
      base({ overlay: { displayId: 1, preset: 'reading', transparent: true, areaRatio: 0.6 } }),
    );
    expect(verdict.status).toBe('AMBER');
    expect(verdict.actions).toHaveLength(1);
    expect(verdict.actions[0]!.id).toBe('enable-compatibility-mode');
  });

  it('RED: user reports the overlay is visible (single display)', () => {
    const verdict = evaluatePreflight(base({ userReport: 'visible' }));
    expect(verdict.status).toBe('RED');
    expect(verdict.actions.map((action) => action.id)).toEqual([
      'window-share-guidance',
      'run-self-check',
    ]);
    expect(verdict.actions.map((action) => action.order)).toEqual([1, 2]);
    expect(verdict.headline.toLowerCase()).toContain("don't rely");
  });

  it('RED: visible report + compatibility mode is still a RED setup', () => {
    const verdict = evaluatePreflight(base({ userReport: 'visible', compatMode: true }));
    expect(verdict.status).toBe('RED');
    expect(verdict.why.join(' ')).toContain('compatibility mode ON');
  });

  it('RED: visible report with a second display recommends move + window share', () => {
    const verdict = evaluatePreflight(base({ displays: [primary, secondary], userReport: 'visible' }));
    expect(verdict.status).toBe('RED');
    expect(verdict.actions.map((action) => action.id)).toEqual([
      'move-to-monitor-2',
      'window-share-guidance',
    ]);
  });

  it('RED: known-ignoring capture path on a single display', () => {
    const verdict = evaluatePreflight(base({ capturePathHint: 'DXGI Desktop Duplication' }));
    expect(verdict.status).toBe('RED');
    expect(verdict.facts.knownIgnoringCapturePath).toBe(true);
    expect(verdict.actions.map((action) => action.id)).toContain('window-share-guidance');
  });

  it('RED: high-risk native app on a single display', () => {
    const verdict = evaluatePreflight(base({ detectedApps: detected('zoom') }));
    expect(verdict.status).toBe('RED');
    expect(verdict.facts.highestCaptureRisk).toBe('high');
  });

  it('high-risk app + second display stays AMBER (move is structurally better than RED)', () => {
    const verdict = evaluatePreflight(
      base({ displays: [primary, secondary], detectedApps: detected('zoom') }),
    );
    expect(verdict.status).toBe('AMBER');
    expect(verdict.actions[0]!.id).toBe('move-to-monitor-2');
  });

  it('every AMBER verdict has exactly one action; every GREEN has none', () => {
    const scenarios: PreflightInput[] = [
      base(),
      base({ displays: [primary, secondary] }),
      base({ overlay: { displayId: 1, preset: 'reading', areaRatio: 0.7 } }),
    ];
    for (const scenario of scenarios) {
      const verdict = evaluatePreflight(scenario);
      expect(verdict.status).toBe('AMBER');
      expect(verdict.actions).toHaveLength(1);
    }
  });

  it('always includes the honest no-detection note and list stamp', () => {
    for (const scenario of [
      base(),
      base({ userReport: 'visible' }),
      base({ displays: [primary, secondary], overlay: { displayId: 2 } }),
    ]) {
      const verdict = evaluatePreflight(scenario);
      expect(verdict.honestNote).toBe(HONEST_DETECTION_COPY);
      expect(verdict.honestNote.toLowerCase()).toContain("can't reliably detect");
      expect(verdict.facts.appListVersion).toBe(TESTED_APPS_LIST_VERSION);
      expect(verdict.facts.appListTestedOn).toBe(TESTED_APPS_TESTED_ON);
    }
  });

  it('uses only catalog action ids, ordered 1..n', () => {
    for (const scenario of [
      base({ userReport: 'visible' }),
      base({ displays: [primary, secondary] }),
      base({ capturePathHint: 'ddagrab' }),
    ]) {
      const verdict = evaluatePreflight(scenario);
      verdict.actions.forEach((action, index) => {
        expect(PREFLIGHT_ACTION_CATALOG[action.id]).toBeDefined();
        expect(action.order).toBe(index + 1);
      });
    }
  });

  it('handles an empty display list without crashing', () => {
    const verdict = evaluatePreflight(base({ displays: [] }));
    expect(verdict.status).toBe('AMBER');
    expect(verdict.actions[0]!.id).toBe('run-self-check');
  });

  it('offers black box mode for DXGI-risk single-display setups (U1)', () => {
    const knownPath = evaluatePreflight(base({ capturePathHint: 'DXGI Desktop Duplication' }));
    expect(knownPath.status).toBe('RED');
    expect(knownPath.actions[0]!.id).toBe('enable-black-box-mode');

    const highRiskApp = evaluatePreflight(base({ detectedApps: detected('zoom') }));
    expect(highRiskApp.status).toBe('RED');
    expect(highRiskApp.actions.map((action) => action.id)).toContain('enable-black-box-mode');

    // A generic visible report without a known-ignoring path keeps the original
    // guidance (black box is offered only where 0x01 is known to help).
    const generic = evaluatePreflight(base({ userReport: 'visible' }));
    expect(generic.actions.map((action) => action.id)).not.toContain('enable-black-box-mode');
  });
});

describe('curated app detection -> risk', () => {
  it('matches processes and titles from the data list', () => {
    expect(matchTestedApps({ processName: 'Zoom.exe' }).map((match) => match.appId)).toEqual(['zoom']);
    expect(
      matchTestedApps({ processName: 'ms-teams.exe', windowTitle: 'Microsoft Teams' }).map(
        (match) => match.appId,
      ),
    ).toContain('microsoft-teams');
    expect(
      matchTestedApps({ windowTitle: 'Meet - abc-defg-hij - Google Chrome' }).map(
        (match) => match.appId,
      ),
    ).toContain('google-meet');
    expect(matchTestedApps({ processName: 'notepad.exe', windowTitle: 'Untitled' })).toEqual([]);
  });

  it('orders risk and detects known-ignoring hints', () => {
    expect(highestRisk(['unknown', 'medium', 'high'])).toBe('high');
    expect(highestRisk([])).toBe('unknown');
    expect(detectKnownIgnoringCapturePath('DXGI Desktop Duplication')).toBe(true);
    expect(detectKnownIgnoringCapturePath('hardware capture path')).toBe(true);
    expect(detectKnownIgnoringCapturePath('window capture')).toBe(false);
    expect(detectKnownIgnoringCapturePath(null)).toBe(false);
  });
});

describe('Electron context -> pre-flight input', () => {
  it('maps displays, overlay placement and capture state', () => {
    const input = contextToPreflightInput({
      displays: [primary, secondary],
      overlayBounds: { x: 2200, y: 100, width: 700, height: 360 },
      captureState: {
        lastProfile: 'reading',
        compatMode: true,
        reportedVisible: false,
        lastSelfCheckAt: 1_700_000_000_000,
        knownBadCapturePath: 'dxgi',
        overlayAreaRatio: 0.55,
      },
    });
    expect(input.overlay?.displayId).toBe(2);
    expect(input.overlay?.preset).toBe('reading');
    expect(input.overlay?.transparent).toBe(false);
    expect(input.userReport).toBe('hidden');
    expect(input.compatMode).toBe(true);
    expect(input.capturePathHint).toBe('dxgi');
  });

  it('derives visible reports and honours display-id overrides', () => {
    const input = contextToPreflightInput({
      displays: [primary],
      overlayDisplayId: 1,
      captureState: { reportedVisible: true },
    });
    expect(input.userReport).toBe('visible');
    expect(input.overlay?.displayId).toBe(1);
    expect(input.overlay?.transparent).toBe(true);
  });
});

describe('action routing', () => {
  const moveAction = {
    id: 'move-to-monitor-2' as const,
    label: 'move',
    description: 'move',
    kind: 'one-click' as const,
    order: 1,
  };
  const compatAction = { ...moveAction, id: 'enable-compatibility-mode' as const };
  const checkAction = { ...moveAction, id: 'run-self-check' as const };
  const shareAction = { ...moveAction, id: 'window-share-guidance' as const, kind: 'info' as const };

  it('routes each action to the host', async () => {
    const calls: string[] = [];
    const host = {
      moveOverlayToDisplay: (displayId: number) => calls.push('move:' + displayId),
      setCompatibilityMode: (enabled: boolean) => calls.push('compat:' + enabled),
      runSelfCheck: (kind: string) => calls.push('check:' + kind),
      showWindowShareGuidance: () => calls.push('share'),
    };
    expect(await routePreflightAction(moveAction, host, { moveOverlayToDisplayId: 2 })).toMatchObject({
      handled: true,
    });
    expect(await routePreflightAction(compatAction, host)).toMatchObject({ handled: true });
    expect(await routePreflightAction(checkAction, host)).toMatchObject({ handled: true });
    expect(await routePreflightAction(shareAction, host)).toMatchObject({ handled: true });
    expect(calls).toEqual(['move:2', 'compat:true', 'check:black-bar-leak', 'share']);
  });

  it('fails closed when a host action is missing or throws', async () => {
    const noHost = await routePreflightAction(moveAction, null, { moveOverlayToDisplayId: 2 });
    expect(noHost.handled).toBe(false);
    expect(noHost.message).toContain('not wired');

    const throwing = await routePreflightAction(compatAction, {
      setCompatibilityMode: () => {
        throw new Error('ipc down');
      },
    });
    expect(throwing.handled).toBe(false);
    expect(throwing.message).toContain('ipc down');
  });

  it('builds a host from the renderer bridges', () => {
    const calls: string[] = [];
    const host = createRendererPreflightHost({
      hireshadePreflight: {
        moveToDisplay: async (id: number) => calls.push('move:' + id),
        showSelfCheck: async (kind: string) => calls.push('check:' + kind),
      },
      hireshadeCapture: {
        setCompatMode: async (enabled: boolean) => calls.push('compat:' + enabled),
      },
    });
    expect(typeof host.moveOverlayToDisplay).toBe('function');
    expect(typeof host.setCompatibilityMode).toBe('function');
    expect(typeof host.runSelfCheck).toBe('function');
  });
});
