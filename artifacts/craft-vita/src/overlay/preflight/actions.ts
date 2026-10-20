/** One-click pre-flight action catalog (S3). Four actions, ordered by impact. */
import type { PreflightAction, PreflightActionId } from './types';

export interface PreflightActionDefinition {
  readonly id: PreflightActionId;
  readonly label: string;
  readonly description: string;
  readonly kind: 'one-click' | 'info';
}

export const PREFLIGHT_ACTION_CATALOG: Readonly<Record<PreflightActionId, PreflightActionDefinition>> = {
  'move-to-monitor-2': {
    id: 'move-to-monitor-2',
    label: 'Move HireShade to monitor 2',
    description:
      'Keep the overlay on the other display. Full-screen shares of the meeting display then cannot contain it - this works regardless of capture path.',
    kind: 'one-click',
  },
  'window-share-guidance': {
    id: 'window-share-guidance',
    label: 'Share a window or tab instead of the screen',
    description:
      'Window/tab shares capture only that surface. This avoids whole-screen capture paths (such as DXGI Desktop Duplication) that can ignore window exclusion.',
    kind: 'info',
  },
  'enable-compatibility-mode': {
    id: 'enable-compatibility-mode',
    label: 'Turn on the dark surface (cosmetic)',
    description:
      'Opaque scrim for contrast/readability. DEMOTED: V1 measured it identical to the transparent surface on all five capture paths under 0x11 (GDI, desktopCapturer screen/window, PrintWindow, DXGI), including a 0x00 positive control. It is not a capture mitigation.',
    kind: 'one-click',
  },
  'enable-black-box-mode': {
    id: 'enable-black-box-mode',
    label: 'Turn on black box mode (optional concealment)',
    description:
      'Switches exclusion to WDA_MONITOR (0x01): capture apps see a black rectangle instead of your answers. OPTIONAL, not load-bearing: X1 measured 0x11 hidden on DXGI in 20/20 marker runs on a software-composited host, so it is not required there; GPU-composited DXGI is unverified. THE COST: on paths that already hid the overlay (GDI, PrintWindow, desktopCapturer) you trade invisibility for a discoverable black band. Offer only for a known-DXGI/high-risk single-display setup, after window/tab sharing, and not as an upgrade.',
    kind: 'one-click',
  },
  'switch-to-compact': {
    id: 'switch-to-compact',
    label: 'Switch to COMPACT overlay',
    description:
      'Keeps black box mode on but shrinks the window, so the black band reads as a small docked panel instead of a full-width slab. Recommended whenever black box mode is enabled.',
    kind: 'one-click',
  },
  'switch-back-to-invisible': {
    id: 'switch-back-to-invisible',
    label: 'Switch back to invisible mode',
    description:
      'Returns to WDA_EXCLUDEFROMCAPTURE (0x11, invisible). Use this when no known-DXGI/high-risk setup was detected: black box mode is a targeted mitigation, not an upgrade, and it makes paths that already worked show a black band.',
    kind: 'one-click',
  },
  'run-self-check': {
    id: 'run-self-check',
    label: 'Run the screen-share self-check',
    description:
      'Show a high-contrast pattern (including a black-bar leak pattern) and confirm on the other device whether the overlay is visible.',
    kind: 'one-click',
  },
};

export function makeAction(id: PreflightActionId, order: number): PreflightAction {
  const definition = PREFLIGHT_ACTION_CATALOG[id];
  return { ...definition, order };
}
