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
    label: 'Turn on compatibility mode',
    description:
      'Opaque surface with a solid scrim (no transparency/blur/rounded compositing). More reliable in some capture paths; not a guarantee.',
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
