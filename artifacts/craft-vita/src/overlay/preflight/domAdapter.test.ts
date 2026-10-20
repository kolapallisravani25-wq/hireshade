import { describe, expect, it, vi } from 'vitest';
import { createPreflightController, createPreflightPanel } from './domAdapter';
import type { PreflightInput } from './types';

interface FakeElement {
  tagName: string;
  children: FakeElement[];
  attrs: Map<string, string>;
  listeners: Map<string, () => void>;
  text: string;
  textContent: string;
  appendChild(child: FakeElement): FakeElement;
  replaceChildren(...children: FakeElement[]): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  addEventListener(type: string, listener: () => void): void;
  click(): void;
}

class Element implements FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, () => void>();
  text = '';
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
    this.text = '';
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }
  click(): void {
    this.listeners.get('click')?.();
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new Element(tagName);
  }
}

function all(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap((child) => all(child))];
}

function byTestId(root: FakeElement, id: string): FakeElement | undefined {
  return all(root).find((element) => element.getAttribute('data-testid') === id);
}

function actionButtons(root: FakeElement): FakeElement[] {
  // data-action-id is set only on action buttons; the result paragraph uses
  // data-testid="preflight-action-result" and must not be counted.
  return all(root).filter((element) => element.getAttribute('data-action-id') !== null);
}

const AMBER_INPUT: PreflightInput = {
  displays: [
    { id: 1, primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, primary: false, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
  ],
  overlay: { displayId: 1, preset: 'banner' },
};

const GREEN_INPUT: PreflightInput = {
  displays: AMBER_INPUT.displays,
  overlay: { displayId: 2, preset: 'banner' },
};

const RED_INPUT: PreflightInput = {
  displays: [AMBER_INPUT.displays[0]!],
  overlay: { displayId: 1 },
  userReport: 'visible',
};

function mount(input: PreflightInput, host = {}) {
  const document = new FakeDocument();
  const container = new Element('div');
  const controller = createPreflightController({ input, host });
  const panel = createPreflightPanel({
    document: document as never,
    container: container as never,
    controller,
  });
  return { document, container, controller, panel };
}

describe('pre-flight DOM panel', () => {
  it('renders the AMBER verdict, one action and the honest note', () => {
    const { panel } = mount(AMBER_INPUT);
    const root = panel.element;
    expect(root.getAttribute('data-status')).toBe('AMBER');
    expect(byTestId(root, 'preflight-status')?.textContent).toBe('AMBER');
    expect(byTestId(root, 'preflight-headline')?.textContent).toContain('monitor 2');
    expect(byTestId(root, 'preflight-message')?.textContent.length).toBeGreaterThan(20);
    expect(actionButtons(root)).toHaveLength(1);
    expect(actionButtons(root)[0]!.getAttribute('data-action-id')).toBe('move-to-monitor-2');
    expect(byTestId(root, 'preflight-recommendation')?.getAttribute('data-default')).toBe('true');
    expect(byTestId(root, 'preflight-honest')?.textContent).toContain("can't reliably detect");
    expect(byTestId(root, 'preflight-why')?.children.length).toBeGreaterThan(0);
  });

  it('renders GREEN with no actions', () => {
    const { panel } = mount(GREEN_INPUT);
    expect(panel.element.getAttribute('data-status')).toBe('GREEN');
    expect(actionButtons(panel.element)).toHaveLength(0);
    expect(byTestId(panel.element, 'preflight-action-result')?.textContent).toBe('Nothing to do.');
  });

  it('renders RED with two ordered actions', () => {
    const { panel } = mount(RED_INPUT);
    const buttons = actionButtons(panel.element);
    expect(panel.element.getAttribute('data-status')).toBe('RED');
    expect(buttons.map((button) => button.getAttribute('data-action-id'))).toEqual([
      'window-share-guidance',
      'run-self-check',
    ]);
  });

  it('routes a move click to the host and reports the result', async () => {
    const moveOverlayToDisplay = vi.fn(async () => undefined);
    const { panel } = mount(AMBER_INPUT, { moveOverlayToDisplay });
    const button = actionButtons(panel.element)[0]!;
    button.click();
    await vi.waitFor(() => {
      expect(moveOverlayToDisplay).toHaveBeenCalledWith(2);
      expect(byTestId(panel.element, 'preflight-action-result')?.textContent).toBe(
        'Moved HireShade to monitor 2.',
      );
      expect(byTestId(panel.element, 'preflight-action-result')?.getAttribute('data-handled')).toBe('true');
    });
  });

  it('routes compatibility-mode and self-check clicks', async () => {
    const setCompatibilityMode = vi.fn(async () => undefined);
    const runSelfCheck = vi.fn(async () => undefined);

    const compat = mount(
      {
        displays: [AMBER_INPUT.displays[0]!],
        overlay: { displayId: 1, preset: 'reading', transparent: true, areaRatio: 0.7 },
      },
      { setCompatibilityMode },
    );
    actionButtons(compat.panel.element)[0]!.click();
    await vi.waitFor(() => expect(setCompatibilityMode).toHaveBeenCalledWith(true));

    const check = mount(
      { displays: [AMBER_INPUT.displays[0]!], overlay: { displayId: 1 } },
      { runSelfCheck },
    );
    actionButtons(check.panel.element)[0]!.click();
    await vi.waitFor(() => expect(runSelfCheck).toHaveBeenCalledWith('black-bar-leak'));
  });

  it('fails closed when the host is missing or throws', async () => {
    const missing = mount(AMBER_INPUT, {});
    actionButtons(missing.panel.element)[0]!.click();
    await vi.waitFor(() => {
      expect(byTestId(missing.panel.element, 'preflight-action-result')?.textContent).toContain(
        'not wired',
      );
    });

    const throwing = mount(AMBER_INPUT, {
      moveOverlayToDisplay: () => {
        throw new Error('ipc down');
      },
    });
    actionButtons(throwing.panel.element)[0]!.click();
    await vi.waitFor(() => {
      expect(byTestId(throwing.panel.element, 'preflight-action-result')?.textContent).toContain(
        'ipc down',
      );
    });
  });

  it('re-renders after an input update', () => {
    const { controller, panel } = mount(AMBER_INPUT);
    expect(panel.element.getAttribute('data-status')).toBe('AMBER');
    const verdict = controller.update(GREEN_INPUT);
    panel.render(verdict);
    expect(panel.element.getAttribute('data-status')).toBe('GREEN');
    expect(actionButtons(panel.element)).toHaveLength(0);
    expect(panel.element.getAttribute('data-list-version')).toBe(verdict.facts.appListVersion);
  });
});
