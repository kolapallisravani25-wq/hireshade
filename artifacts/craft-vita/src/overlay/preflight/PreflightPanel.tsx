/**
 * React pre-flight card (S3). Thin view over the pure evaluator + action router;
 * mirrors the framework-free adapter's data-testids so either surface can be
 * asserted by CDP/unit tests.
 */
import * as React from 'react';
import { evaluatePreflight } from './preflight';
import { routePreflightAction } from './routing';
import type { PreflightAction, PreflightHostActions, PreflightInput } from './types';

export interface PreflightPanelProps {
  readonly input: PreflightInput;
  readonly host?: PreflightHostActions | null;
  readonly onAction?: (message: string) => void;
  readonly className?: string;
}

export function usePreflight(input: PreflightInput) {
  return React.useMemo(() => evaluatePreflight(input), [input]);
}

export function PreflightPanel({ input, host, onAction, className }: PreflightPanelProps) {
  const verdict = usePreflight(input);
  const [result, setResult] = React.useState<string | null>(null);

  const handleAction = React.useCallback(
    (action: PreflightAction) => {
      setResult('Working...');
      void routePreflightAction(action, host, {
        moveOverlayToDisplayId: verdict.recommendation.moveOverlayToDisplayId,
      }).then((routed) => {
        setResult(routed.message);
        try {
          onAction?.(routed.message);
        } catch {
          // UI callbacks must not break the card.
        }
      });
    },
    [host, onAction, verdict.recommendation.moveOverlayToDisplayId],
  );

  return (
    <section
      className={className ?? 'hireshade-preflight'}
      data-testid="preflight-panel"
      data-status={verdict.status}
      data-list-version={verdict.facts.appListVersion}
      aria-live="polite"
    >
      <header>
        <span data-testid="preflight-status" data-status={verdict.status}>
          {verdict.status}
        </span>
        <h2 data-testid="preflight-headline">{verdict.headline}</h2>
      </header>
      <p data-testid="preflight-message">{verdict.message}</p>
      <ul data-testid="preflight-why">
        {verdict.why.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <div data-testid="preflight-actions">
        {verdict.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            data-testid={'preflight-action-' + action.id}
            data-action-id={action.id}
            title={action.description}
            onClick={() => handleAction(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
      <p data-testid="preflight-recommendation" data-default={String(verdict.recommendation.isDefaultRecommendation)}>
        {verdict.recommendation.copy}
      </p>
      <p data-testid="preflight-honest">{verdict.honestNote}</p>
      <p data-testid="preflight-action-result">{result}</p>
    </section>
  );
}
