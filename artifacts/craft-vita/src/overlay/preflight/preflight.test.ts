import { describe, expect, it, vi } from 'vitest';
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

  it('V1 demotion: a large transparent overlay no longer recommends compatibility mode', () => {
    const verdict = evaluatePreflight(
      base({ overlay: { displayId: 1, preset: 'reading', transparent: true, areaRatio: 0.6 } }),
    );
    expect(verdict.status).toBe('AMBER');
    expect(verdict.actions).toHaveLength(1);
    expect(verdict.actions[0]!.id).toBe('run-self-check');
    expect(verdict.actions.map((action) => action.id)).not.toContain('enable-compatibility-mode');
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

  it('AMBER has exactly one action, except black-box-mode cases (undo + shrink)', () => {
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
    // Black box mode may legitimately expose two: undo + switch to COMPACT.
    const blackBox = evaluatePreflight(
      base({ affinityMode: 'monitor', overlay: { displayId: 1, preset: 'banner' } }),
    );
    expect(blackBox.status).toBe('AMBER');
    expect(blackBox.actions).toHaveLength(2);
    expect(blackBox.actions.map((action) => action.id)).toEqual([
      'switch-back-to-invisible',
      'switch-to-compact',
    ]);
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
    // X1 demotion: window/tab sharing ranks first; black box is optional.
    expect(knownPath.actions[0]!.id).toBe('window-share-guidance');
    expect(knownPath.actions.map((action) => action.id)).toContain('enable-black-box-mode');

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
describe('V2 affinity hardening: black box is a targeted mitigation, never a default', () => {
  it('never offers WDA_MONITOR(0x01) on setups that are not known-DXGI/high-risk single-display', () => {
    const nonEligible: PreflightInput[] = [
      base(), // single display, unknown app, no hint
      base({ detectedApps: detected('google-meet') }), // medium risk
      base({ userReport: 'visible' }), // visible but no known-ignoring setup
      base({ displays: [primary, secondary], detectedApps: detected('zoom') }), // structural fix available
      base({ capturePathHint: 'DXGI Desktop Duplication', userReport: 'hidden' }), // already verified hidden
    ];
    for (const scenario of nonEligible) {
      const verdict = evaluatePreflight(scenario);
      expect(verdict.actions.map((action) => action.id)).not.toContain('enable-black-box-mode');
      expect(verdict.facts.affinityMode).toBe('exclude');
      expect(verdict.facts.blackBoxEligible).toBe(false);
    }
  });

  it('offers black box exactly for a known-DXGI or high-risk SINGLE-display setup', () => {
    const knownPath = evaluatePreflight(base({ capturePathHint: 'DXGI Desktop Duplication' }));
    expect(knownPath.facts.blackBoxEligible).toBe(true);
    expect(knownPath.actions[0]!.id).toBe('window-share-guidance');

    const highRisk = evaluatePreflight(base({ detectedApps: detected('zoom') }));
    expect(highRisk.facts.blackBoxEligible).toBe(true);
    expect(highRisk.actions[0]!.id).toBe('window-share-guidance');

    const highRiskWithSecondDisplay = evaluatePreflight(
      base({ displays: [primary, secondary], detectedApps: detected('zoom') }),
    );
    expect(highRiskWithSecondDisplay.facts.blackBoxEligible).toBe(false);
    expect(highRiskWithSecondDisplay.actions[0]!.id).toBe('move-to-monitor-2');
  });

  it('states the cost of black box mode in the action copy and RED message', () => {
    const description = PREFLIGHT_ACTION_CATALOG['enable-black-box-mode'].description;
    for (const token of ['GDI', 'PrintWindow', 'desktopCapturer', 'black band', 'discoverable', 'not as an upgrade']) {
      expect(description.toLowerCase()).toContain(token.toLowerCase());
    }
    const verdict = evaluatePreflight(base({ capturePathHint: 'DXGI Desktop Duplication' }));
    expect(verdict.message.toLowerCase()).toContain('black band');
    expect(verdict.message.toLowerCase()).toContain('discoverable');
    expect(verdict.why.join(' ').toLowerCase()).toContain('gdi');
  });

  it('when black box is ON without a known-bad/high-risk setup, offers the undo', () => {
    const banner = evaluatePreflight(
      base({ affinityMode: 'monitor', overlay: { displayId: 1, preset: 'banner' } }),
    );
    expect(banner.status).toBe('AMBER');
    expect(banner.headline).toContain('Switch back');
    expect(banner.facts.affinityMode).toBe('monitor');
    expect(banner.actions.map((action) => action.id)).toEqual([
      'switch-back-to-invisible',
      'switch-to-compact',
    ]);
    expect(banner.message).toContain('not targeted at anything here');
    expect(banner.message.toLowerCase()).toContain('black band');

    const card = evaluatePreflight(
      base({ affinityMode: 'monitor', overlay: { displayId: 1, preset: 'card' } }),
    );
    expect(card.actions.map((action) => action.id)).toEqual(['switch-back-to-invisible']);

    // Also shown when a second display exists (black box is only justified on
    // single-display setups) or when the user already confirmed hidden.
    const withSecond = evaluatePreflight(
      base({ affinityMode: 'monitor', displays: [primary, secondary], overlay: { displayId: 2 } }),
    );
    expect(withSecond.actions.map((action) => action.id)).toContain('switch-back-to-invisible');
  });

  it('when black box is justified, recommends COMPACT via a one-click action', () => {
    const banner = evaluatePreflight(
      base({ affinityMode: 'monitor', capturePathHint: 'dxgi', overlay: { displayId: 1, preset: 'banner' } }),
    );
    expect(banner.status).toBe('AMBER');
    expect(banner.headline).toContain('Shrink the black band');
    expect(banner.actions.map((action) => action.id)).toEqual(['switch-to-compact']);
    expect(banner.recommendation.recommendedPresetId).toBe('card');
    expect(banner.recommendation.copy).toContain('COMPACT');
    expect(banner.recommendation.copy.toLowerCase()).toContain('docked panel');

    const reading = evaluatePreflight(
      base({ affinityMode: 'monitor', detectedApps: detected('zoom'), overlay: { displayId: 1, preset: 'reading' } }),
    );
    expect(reading.actions[0]!.id).toBe('switch-to-compact');

    const compact = evaluatePreflight(
      base({ affinityMode: 'monitor', capturePathHint: 'dxgi', overlay: { displayId: 1, preset: 'card' } }),
    );
    expect(compact.status).toBe('GREEN');
    expect(compact.actions).toEqual([]);
    expect(compact.recommendation.recommendedPresetId).toBeNull();
    expect(compact.message.toLowerCase()).toContain('black band');
  });

  it('black box ON + visible report is RED (mitigation failed) with the undo available', () => {
    const verdict = evaluatePreflight(base({ affinityMode: 'monitor', userReport: 'visible' }));
    expect(verdict.status).toBe('RED');
    expect(verdict.actions.map((action) => action.id)).toEqual([
      'window-share-guidance',
      'switch-back-to-invisible',
    ]);
    expect(verdict.message.toLowerCase()).toContain('black band');
  });
});
describe('V2 affinity routing + context mapping', () => {
  const actionOf = (id: keyof typeof PREFLIGHT_ACTION_CATALOG) => ({
    ...PREFLIGHT_ACTION_CATALOG[id],
    order: 1,
  });

  it('maps affinityMode from capture state (default exclude)', () => {
    const monitor = contextToPreflightInput({
      displays: [primary],
      captureState: { affinityMode: 'monitor' },
    });
    expect(monitor.affinityMode).toBe('monitor');

    const exclude = contextToPreflightInput({
      displays: [primary],
      captureState: { lastProfile: 'banner' },
    });
    expect(exclude.affinityMode).toBe('exclude');
  });

  it('switch-to-compact calls the capture applyProfile adapter with card', async () => {
    const setCaptureProfile = vi.fn(async () => undefined);
    const result = await routePreflightAction(actionOf('switch-to-compact'), { setCaptureProfile });
    expect(result.handled).toBe(true);
    expect(setCaptureProfile).toHaveBeenCalledWith('card');
    expect(result.message).toContain('COMPACT');
    expect(result.message).toContain('docked');
  });

  it('switch-back-to-invisible disables black box mode and states the benefit', async () => {
    const setBlackBoxMode = vi.fn(async () => undefined);
    const result = await routePreflightAction(actionOf('switch-back-to-invisible'), { setBlackBoxMode });
    expect(result.handled).toBe(true);
    expect(setBlackBoxMode).toHaveBeenCalledWith(false);
    expect(result.message).toContain('0x11');
    expect(result.message.toLowerCase()).toContain('invisible');
  });

  it('black box enable message repeats the cost on already-working paths', async () => {
    const setBlackBoxMode = vi.fn(async () => undefined);
    const result = await routePreflightAction(actionOf('enable-black-box-mode'), { setBlackBoxMode });
    expect(result.handled).toBe(true);
    expect(setBlackBoxMode).toHaveBeenCalledWith(true);
    for (const token of ['GDI', 'PrintWindow', 'desktopCapturer', 'black band', 'discoverable']) {
      expect(result.message.toLowerCase()).toContain(token.toLowerCase());
    }
  });

  it('new actions fail closed when the host is not wired', async () => {
    const compact = await routePreflightAction(actionOf('switch-to-compact'), null);
    expect(compact.handled).toBe(false);
    expect(compact.message).toContain('not wired');

    const undo = await routePreflightAction(actionOf('switch-back-to-invisible'), {});
    expect(undo.handled).toBe(false);
  });

  it('renderer host maps affinity + profile bridges', async () => {
    const calls: string[] = [];
    const host = createRendererPreflightHost({
      hireshadeCapture: {
        setAffinityMode: async (mode: 'monitor' | 'exclude') => calls.push('affinity:' + mode),
        applyProfile: async (profile: string) => calls.push('profile:' + profile),
      },
    });
    await host.setBlackBoxMode?.(true);
    await host.setBlackBoxMode?.(false);
    await host.setCaptureProfile?.('card');
    expect(calls).toEqual(['affinity:monitor', 'affinity:exclude', 'profile:card']);
  });
});
