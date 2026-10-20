/**
 * Framework-free pre-flight panel (S3). Pure verdict -> DOM; actions route
 * through the host. Used by the React wrapper and directly by the demo/self-check
 * surfaces; tested with a fake DOM (node env, no jsdom).
 */
import { evaluatePreflight } from './preflight';
import { routePreflightAction, type RoutedActionResult } from './routing';
import type {
  PreflightAction,
  PreflightActionId,
  PreflightHostActions,
  PreflightInput,
  PreflightVerdict,
} from './types';

export interface PreflightController {
  getVerdict(): PreflightVerdict;
  update(input: PreflightInput): PreflightVerdict;
  dispatch(actionId: PreflightActionId): Promise<RoutedActionResult>;
}

export interface PreflightControllerOptions {
  readonly input: PreflightInput;
  readonly host?: PreflightHostActions | null;
  readonly onChange?: (verdict: PreflightVerdict) => void;
}

export function createPreflightController(
  options: PreflightControllerOptions,
): PreflightController {
  let input = options.input;
  let verdict = evaluatePreflight(input);
  const notify = () => {
    try {
      options.onChange?.(verdict);
    } catch {
      // UI callbacks must never break pre-flight.
    }
  };
  return {
    getVerdict: () => verdict,
    update: (next) => {
      input = next;
      verdict = evaluatePreflight(input);
      notify();
      return verdict;
    },
    dispatch: async (actionId) => {
      const action = verdict.actions.find((candidate) => candidate.id === actionId);
      if (!action) {
        return { actionId, handled: false, message: 'That action is not part of the current verdict.' };
      }
      return routePreflightAction(action, options.host, {
        moveOverlayToDisplayId: verdict.recommendation.moveOverlayToDisplayId,
      });
    },
  };
}

export interface DomElementLike {
  readonly tagName?: string;
  textContent: string;
  appendChild(child: DomElementLike): DomElementLike;
  setAttribute(name: string, value: string): void;
  getAttribute?(name: string): string | null;
  addEventListener(type: string, listener: () => void): void;
  replaceChildren?(...children: DomElementLike[]): void;
  children?: ArrayLike<DomElementLike>;
}

export interface DomDocumentLike {
  createElement(tagName: string): DomElementLike;
}

export interface PreflightPanelOptions {
  readonly document: DomDocumentLike;
  readonly container: DomElementLike;
  readonly controller: PreflightController;
  readonly onAction?: (result: RoutedActionResult) => void;
}

export interface PreflightPanel {
  readonly element: DomElementLike;
  render(verdict?: PreflightVerdict): void;
  destroy(): void;
}

function el(document: DomDocumentLike, tag: string, attributes?: Record<string, string>): DomElementLike {
  const element = document.createElement(tag);
  if (attributes) {
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  }
  return element;
}

function clear(element: DomElementLike): void {
  if (typeof element.replaceChildren === 'function') {
    element.replaceChildren();
    return;
  }
  element.textContent = '';
}

/** Mounts the pre-flight panel and renders the current verdict. */
export function createPreflightPanel(options: PreflightPanelOptions): PreflightPanel {
  const { document, container, controller } = options;
  const root = el(document, 'section', {
    'data-testid': 'preflight-panel',
    class: 'hireshade-preflight',
  });
  const header = el(document, 'header');
  const statusBadge = el(document, 'span', { 'data-testid': 'preflight-status' });
  const headline = el(document, 'h2', { 'data-testid': 'preflight-headline' });
  header.appendChild(statusBadge);
  header.appendChild(headline);
  const message = el(document, 'p', { 'data-testid': 'preflight-message' });
  const whyList = el(document, 'ul', { 'data-testid': 'preflight-why' });
  const actionsRow = el(document, 'div', { 'data-testid': 'preflight-actions' });
  const recommendation = el(document, 'p', { 'data-testid': 'preflight-recommendation' });
  const honest = el(document, 'p', { 'data-testid': 'preflight-honest' });
  const actionResult = el(document, 'p', { 'data-testid': 'preflight-action-result' });
  root.appendChild(header);
  root.appendChild(message);
  root.appendChild(whyList);
  root.appendChild(actionsRow);
  root.appendChild(recommendation);
  root.appendChild(honest);
  root.appendChild(actionResult);
  container.appendChild(root);

  const describe = (action: PreflightAction) => (
    action.label + ' - ' + action.description
  );

  const render = (verdict?: PreflightVerdict) => {
    const current = verdict ?? controller.getVerdict();
    root.setAttribute('data-status', current.status);
    root.setAttribute('data-list-version', current.facts.appListVersion);
    statusBadge.textContent = current.status;
    statusBadge.setAttribute('data-status', current.status);
    headline.textContent = current.headline;
    message.textContent = current.message;
    clear(whyList);
    for (const reason of current.why) {
      const item = el(document, 'li');
      item.textContent = reason;
      whyList.appendChild(item);
    }
    clear(actionsRow);
    for (const action of current.actions) {
      const button = el(document, 'button', {
        type: 'button',
        'data-testid': 'preflight-action-' + action.id,
        'data-action-id': action.id,
        title: describe(action),
      });
      button.textContent = action.label;
      button.addEventListener('click', () => {
        actionResult.textContent = 'Working...';
        void controller.dispatch(action.id).then((result) => {
          actionResult.textContent = result.message;
          actionResult.setAttribute('data-handled', String(result.handled));
          actionResult.setAttribute('data-action-id', result.actionId);
          try {
            options.onAction?.(result);
          } catch {
            // ignore callback errors
          }
        });
      });
      actionsRow.appendChild(button);
    }
    recommendation.textContent = current.recommendation.copy;
    recommendation.setAttribute(
      'data-default',
      current.recommendation.isDefaultRecommendation ? 'true' : 'false',
    );
    honest.textContent = current.honestNote;
    if (current.actions.length === 0) {
      actionResult.textContent = 'Nothing to do.';
    }
  };

  render();
  return {
    element: root,
    render,
    destroy: () => {
      root.setAttribute('data-destroyed', 'true');
    },
  };
}

/** Small helper the UI can call to update both controller + DOM. */
export function updatePreflightPanel(
  panel: PreflightPanel,
  controller: PreflightController,
  input: PreflightInput,
): PreflightVerdict {
  const verdict = controller.update(input);
  panel.render(verdict);
  return verdict;
}
