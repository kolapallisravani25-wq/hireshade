/**
 * hotkeys — pure hotkey model shared by the Electron desktop shell and the
 * overlay UI.
 *
 * This module intentionally has ZERO runtime imports so it can be:
 *   1. unit-tested by vitest in craft-vita (the app test runner), and
 *   2. compiled to CommonJS for artifacts/desktop-electron (main.js, preload.js)
 *      by scripts/build-main-helpers.js.
 *
 * Binding sets (mirrors the verified competitor model, docs/TARGET_VERIFIED.md
 * T-07, plus HireShade-specific safety keys):
 *   - "app"       : always registered while the desktop shell runs. Must stay
 *                   registered even when every window is hidden, otherwise the
 *                   toggle/panic keys could never bring the overlay back.
 *   - "live-call" : registered only while the live-call overlay is visible, so
 *                   we never steal Cmd/Ctrl+Enter etc. system-wide when idle.
 */

export type OverlayPlatform = "mac" | "win" | "linux";

export type HotkeySet = "app" | "live-call";

export type HotkeyAction =
  | "toggle-overlay"
  | "panic-hide"
  | "cycle-model"
  | "overlay-nudge-up"
  | "overlay-nudge-down"
  | "overlay-nudge-left"
  | "overlay-nudge-right"
  | "live-primary-answer"
  | "live-secondary-answer"
  | "live-prev-message"
  | "live-next-message"
  | "live-prev-ai-message"
  | "live-next-ai-message"
  | "live-hide-overlay";

export interface HotkeyBinding {
  /** Stable action id emitted to the renderer / handled natively in main. */
  readonly action: HotkeyAction;
  /** Registration set this binding belongs to. */
  readonly set: HotkeySet;
  /** Electron accelerator string, e.g. "CommandOrControl+Shift+H". */
  readonly accelerator: string;
  /** Short human label. */
  readonly label: string;
  /** One-line description for settings UI. */
  readonly description: string;
}

/** Main -> renderer event payload channel (desktop:hotkey). */
export const HOTKEY_EVENT_CHANNEL = "desktop:hotkey";

/** Renderer -> main fire-and-forget pointer hit-test channel. */
export const POINTER_PASS_THROUGH_CHANNEL = "desktop:overlay:pointer-pass-through";

/**
 * IPC invoke channel names. Mirrored verbatim in
 * artifacts/desktop-electron/preload.js (sandboxed preloads cannot require
 * local files).
 */
export const DESKTOP_IPC = {
  getSettings: "desktop:overlay:get-settings",
  getHotkeys: "desktop:hotkeys:get-bindings",
  getState: "desktop:overlay:get-state",
  setOpacity: "desktop:overlay:set-opacity",
  setClickThrough: "desktop:overlay:set-click-through",
  setPrivateMode: "desktop:overlay:set-private-mode",
  applyPositionPreset: "desktop:overlay:apply-position-preset",
  debugInvokeAction: "desktop:debug:invoke-action",
} as const;

/**
 * Models cycled by CommandOrControl+Shift+M.
 * MUST stay in sync with AVAILABLE_MODELS in
 * artifacts/craft-vita/src/features/session/slices/floatingSessionSlice.ts.
 */
export const DEFAULT_MODEL_CYCLE: readonly string[] = [
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-sonnet-4.5",
  "google/gemini-3.1-flash-lite-preview",
  "openai/gpt-5",
];

export const DEFAULT_HOTKEYS: readonly HotkeyBinding[] = [
  {
    action: "toggle-overlay",
    set: "app",
    accelerator: "CommandOrControl+Shift+H",
    label: "Toggle overlay",
    description: "Show or hide the floating overlay.",
  },
  {
    action: "panic-hide",
    set: "app",
    accelerator: "CommandOrControl+Shift+X",
    label: "Panic hide",
    description: "Instantly hide every HireShade window.",
  },
  {
    action: "cycle-model",
    set: "app",
    accelerator: "CommandOrControl+Shift+M",
    label: "Cycle model",
    description: "Cycle the AI model used for the next answer.",
  },
  // Verified competitor "app set" (T-07): nudge the overlay with the arrows.
  {
    action: "overlay-nudge-up",
    set: "app",
    accelerator: "CommandOrControl+Shift+Up",
    label: "Nudge overlay up",
    description: "Move the floating overlay up by one step.",
  },
  {
    action: "overlay-nudge-down",
    set: "app",
    accelerator: "CommandOrControl+Shift+Down",
    label: "Nudge overlay down",
    description: "Move the floating overlay down by one step.",
  },
  {
    action: "overlay-nudge-left",
    set: "app",
    accelerator: "CommandOrControl+Shift+Left",
    label: "Nudge overlay left",
    description: "Move the floating overlay left by one step.",
  },
  {
    action: "overlay-nudge-right",
    set: "app",
    accelerator: "CommandOrControl+Shift+Right",
    label: "Nudge overlay right",
    description: "Move the floating overlay right by one step.",
  },
  // Verified competitor "live-call set" (T-07).
  {
    action: "live-primary-answer",
    set: "live-call",
    accelerator: "CommandOrControl+Enter",
    label: "Generate primary answer",
    description: "Generate the primary AI answer for the current question.",
  },
  {
    action: "live-secondary-answer",
    set: "live-call",
    accelerator: "CommandOrControl+Shift+Enter",
    label: "Generate secondary answer",
    description: "Generate an alternative AI answer for the current question.",
  },
  {
    action: "live-prev-message",
    set: "live-call",
    accelerator: "CommandOrControl+Up",
    label: "Previous message",
    description: "Select the previous message in the transcript.",
  },
  {
    action: "live-next-message",
    set: "live-call",
    accelerator: "CommandOrControl+Down",
    label: "Next message",
    description: "Select the next message in the transcript.",
  },
  {
    action: "live-hide-overlay",
    set: "live-call",
    accelerator: "CommandOrControl+H",
    label: "Hide overlay",
    description: "Hide the floating overlay without ending the session.",
  },
  {
    action: "live-prev-ai-message",
    set: "live-call",
    accelerator: "CommandOrControl+Left",
    label: "Previous AI answer",
    description: "Show the previous AI answer.",
  },
  {
    action: "live-next-ai-message",
    set: "live-call",
    accelerator: "CommandOrControl+Right",
    label: "Next AI answer",
    description: "Show the next AI answer.",
  },
];

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = DEFAULT_HOTKEYS.map(
  (binding) => binding.action,
);

function filterSet(set: HotkeySet): readonly HotkeyBinding[] {
  return DEFAULT_HOTKEYS.filter((binding) => binding.set === set);
}

export const APP_HOTKEYS: readonly HotkeyBinding[] = filterSet("app");
export const LIVE_CALL_HOTKEYS: readonly HotkeyBinding[] = filterSet("live-call");

// ─── Accelerator parsing ─────────────────────────────────────────────────────

export type Modifier = "primary" | "control" | "meta" | "alt" | "shift";

export interface ParsedAccelerator {
  readonly modifiers: readonly Modifier[];
  readonly key: string;
}

export type AcceleratorParseResult =
  | { readonly ok: true; readonly value: ParsedAccelerator }
  | { readonly ok: false; readonly error: string };

const MODIFIER_ALIASES: Record<string, Modifier> = {
  commandorcontrol: "primary",
  commandorctrl: "primary",
  cmdorctrl: "primary",
  cmdorcontrol: "primary",
  ctrl: "control",
  control: "control",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  super: "meta",
  win: "meta",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
};

const MODIFIER_ORDER: readonly Modifier[] = ["primary", "control", "meta", "alt", "shift"];

const MODIFIER_NAMES: Record<Modifier, string> = {
  primary: "CommandOrControl",
  control: "Control",
  meta: "Meta",
  alt: "Alt",
  shift: "Shift",
};

const NAMED_KEYS: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  space: "Space",
  spacebar: "Space",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  ins: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pgup: "PageUp",
  pagedown: "PageDown",
  pgdn: "PageDown",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  plus: "Plus",
};

const PUNCTUATION_KEYS = new Set(["=", "-", ",", ".", "/", ";", "'", "[", "]"]);

/** Normalize a keyboard-event key / accelerator key name to a canonical name. */
export function normalizeKey(raw: string): string | null {
  if (typeof raw !== "string") return null;
  if (raw === " ") return "Space";
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "+") return "Plus";
  const lower = trimmed.toLowerCase();
  if (lower.length === 1 && lower >= "a" && lower <= "z") return lower.toUpperCase();
  if (/^[0-9]$/.test(trimmed)) return trimmed;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return "F" + lower.slice(1).toUpperCase();
  const named = NAMED_KEYS[lower];
  if (named) return named;
  if (PUNCTUATION_KEYS.has(trimmed)) return trimmed;
  return null;
}

/** Parse an Electron-style accelerator into modifiers + canonical key. */
export function tryParseAccelerator(accelerator: string): AcceleratorParseResult {
  if (typeof accelerator !== "string" || !accelerator.trim()) {
    return { ok: false, error: "accelerator is empty" };
  }
  // "CommandOrControl++" means CommandOrControl + Plus.
  const expanded = accelerator.trim().replace(/[+]$/, "Plus");
  const parts = expanded
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return { ok: false, error: "accelerator has no key" };

  const keyPart = parts[parts.length - 1];
  const key = normalizeKey(keyPart);
  if (!key) return { ok: false, error: 'unknown key "' + keyPart + '"' };

  const modifiers: Modifier[] = [];
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (!modifier) return { ok: false, error: 'unknown modifier "' + part + '"' };
    if (!modifiers.includes(modifier)) modifiers.push(modifier);
  }
  const sorted = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
  return { ok: true, value: { modifiers: sorted, key } };
}

/** Canonical accelerator string (same semantics, stable formatting/order). */
export function canonicalizeAccelerator(accelerator: string): string | null {
  const parsed = tryParseAccelerator(accelerator);
  if (!parsed.ok) return null;
  const modifiers = parsed.value.modifiers.map((modifier) => MODIFIER_NAMES[modifier]);
  return [...modifiers, parsed.value.key].join("+");
}

// ─── Platform resolution + matching ─────────────────────────────────────────

export function normalizePlatform(platform?: string): OverlayPlatform {
  const value = (platform ?? "").toLowerCase();
  if (value === "mac" || value === "macos" || value === "darwin") return "mac";
  if (value === "linux") return "linux";
  return "win";
}

export interface ModifierFlags {
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export function resolveModifierFlags(
  parsed: ParsedAccelerator,
  platform: OverlayPlatform,
): ModifierFlags {
  const flags = { control: false, meta: false, alt: false, shift: false };
  for (const modifier of parsed.modifiers) {
    switch (modifier) {
      case "primary":
        if (platform === "mac") flags.meta = true;
        else flags.control = true;
        break;
      case "control":
        flags.control = true;
        break;
      case "meta":
        flags.meta = true;
        break;
      case "alt":
        flags.alt = true;
        break;
      case "shift":
        flags.shift = true;
        break;
    }
  }
  return flags;
}

export interface KeyboardEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

function eventKeyMatches(parsedKey: string, eventKey: string): boolean {
  const normalized = normalizeKey(eventKey);
  if (!normalized) return false;
  if (parsedKey === normalized) return true;
  // Shift+= produces "+" on US layouts; treat Plus and "=" as the same key.
  if (parsedKey === "Plus" && (normalized === "Plus" || normalized === "=")) return true;
  if (parsedKey === "=" && normalized === "Plus") return true;
  return false;
}

/** Does a DOM-like KeyboardEvent match an accelerator on this platform? */
export function matchesKeyboardEvent(
  event: KeyboardEventLike,
  accelerator: string,
  platform: OverlayPlatform,
): boolean {
  const parsed = tryParseAccelerator(accelerator);
  if (!parsed.ok) return false;
  const expected = resolveModifierFlags(parsed.value, platform);
  if (
    Boolean(event.ctrlKey) !== expected.control ||
    Boolean(event.metaKey) !== expected.meta ||
    Boolean(event.altKey) !== expected.alt ||
    Boolean(event.shiftKey) !== expected.shift
  ) {
    return false;
  }
  return eventKeyMatches(parsed.value.key, event.key);
}

/** Convert a DOM-like KeyboardEvent into a canonical accelerator string. */
export function keyEventToAccelerator(
  event: KeyboardEventLike,
  platform: OverlayPlatform,
): string | null {
  const key = normalizeKey(event.key);
  if (!key) return null;
  const parts: string[] = [];
  if (platform === "mac") {
    if (event.metaKey) parts.push("CommandOrControl");
    if (event.ctrlKey) parts.push("Control");
  } else {
    if (event.ctrlKey) parts.push("CommandOrControl");
    if (event.metaKey) parts.push("Meta");
  }
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

// ─── Display formatting ─────────────────────────────────────────────────────

const KEY_DISPLAY: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↵",
  Space: "Space",
  Escape: "Esc",
  Plus: "+",
};

const MAC_MODIFIER_DISPLAY: Record<Modifier, string> = {
  primary: "⌘",
  control: "⌃",
  meta: "⌘",
  alt: "⌥",
  shift: "⇧",
};

const PC_MODIFIER_DISPLAY: Record<Modifier, string> = {
  primary: "Ctrl",
  control: "Ctrl",
  meta: "Win",
  alt: "Alt",
  shift: "Shift",
};

/** Human-readable accelerator, e.g. "Ctrl + Shift + H". */
export function formatAccelerator(accelerator: string, platform: OverlayPlatform): string {
  const parsed = tryParseAccelerator(accelerator);
  if (!parsed.ok) return accelerator;
  const key = KEY_DISPLAY[parsed.value.key] ?? parsed.value.key;
  if (platform === "mac") {
    return [...parsed.value.modifiers.map((m) => MAC_MODIFIER_DISPLAY[m]), key].join(" ");
  }
  return [...parsed.value.modifiers.map((m) => PC_MODIFIER_DISPLAY[m]), key].join(" + ");
}

// ─── Validation + conflict detection ────────────────────────────────────────

export type HotkeyIssueCode =
  | "invalid"
  | "missing-modifier"
  | "reserved"
  | "duplicate"
  | "set-overlap";

export interface HotkeyIssue {
  readonly code: HotkeyIssueCode;
  readonly action?: HotkeyAction;
  readonly accelerator: string;
  readonly message: string;
}

export interface AcceleratorValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const RESERVED_ACCELERATORS: Record<OverlayPlatform, readonly string[]> = {
  win: [
    "Alt+F4",
    "Alt+Tab",
    "Alt+Escape",
    "CommandOrControl+Alt+Delete",
    "CommandOrControl+Shift+Escape",
    "CommandOrControl+Escape",
  ],
  linux: [
    "Alt+F4",
    "Alt+Tab",
    "CommandOrControl+Alt+Delete",
    "CommandOrControl+Shift+Escape",
  ],
  mac: [
    "Command+Tab",
    "Command+Space",
    "Command+Option+Escape",
    "Command+Control+F",
    "Command+Q",
    "Command+H",
  ],
};

export function isReservedAccelerator(
  accelerator: string,
  platform: OverlayPlatform,
): boolean {
  const canonical = canonicalizeAccelerator(accelerator);
  if (!canonical) return false;
  return RESERVED_ACCELERATORS[platform].some(
    (reserved) => canonicalizeAccelerator(reserved) === canonical,
  );
}

/** Validate a single accelerator before persisting/registering it. */
export function validateAccelerator(
  accelerator: string,
  platform: OverlayPlatform,
): AcceleratorValidation {
  const parsed = tryParseAccelerator(accelerator);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error], warnings: [] };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  if (parsed.value.modifiers.length === 0) {
    errors.push("at least one modifier (Ctrl/Command/Alt/Shift) is required");
  }
  if (isReservedAccelerator(accelerator, platform)) {
    warnings.push("this combination is reserved by the operating system and may fail to register");
  }
  return { ok: errors.length === 0, errors, warnings };
}

// ─── Binding resolution + conflicts ─────────────────────────────────────────

export type HotkeyOverrides = Partial<Record<HotkeyAction, string>>;

export interface ResolvedHotkeys {
  readonly bindings: readonly HotkeyBinding[];
  readonly issues: readonly HotkeyIssue[];
}

function resolvedBinding(binding: HotkeyBinding, accelerator: string): HotkeyBinding {
  return { ...binding, accelerator };
}

/** Apply user overrides to the default binding table, validating each one. */
export function resolveHotkeys(
  overrides: HotkeyOverrides = {},
  platform: OverlayPlatform = "win",
): ResolvedHotkeys {
  const issues: HotkeyIssue[] = [];
  const bindings: HotkeyBinding[] = DEFAULT_HOTKEYS.map((binding) => {
    const override = overrides[binding.action];
    if (typeof override !== "string" || !override.trim()) return binding;
    const validation = validateAccelerator(override, platform);
    for (const warning of validation.warnings) {
      issues.push({
        code: "reserved",
        action: binding.action,
        accelerator: override,
        message: warning,
      });
    }
    if (!validation.ok) {
      for (const error of validation.errors) {
        issues.push({
          code: error.includes("modifier") ? "missing-modifier" : "invalid",
          action: binding.action,
          accelerator: override,
          message: error + " (kept default)",
        });
      }
      return binding;
    }
    return resolvedBinding(binding, override.trim());
  });
  return { bindings, issues: [...issues, ...findConflicts(bindings, platform)] };
}

/** Detect duplicate accelerators (same or cross set) and reserved combos. */
export function findConflicts(
  bindings: readonly HotkeyBinding[],
  platform: OverlayPlatform,
): HotkeyIssue[] {
  const issues: HotkeyIssue[] = [];
  const seen = new Map<string, HotkeyBinding>();
  for (const binding of bindings) {
    const parsed = tryParseAccelerator(binding.accelerator);
    if (!parsed.ok) {
      issues.push({
        code: "invalid",
        action: binding.action,
        accelerator: binding.accelerator,
        message: parsed.error,
      });
      continue;
    }
    if (parsed.value.modifiers.length === 0) {
      issues.push({
        code: "missing-modifier",
        action: binding.action,
        accelerator: binding.accelerator,
        message: "at least one modifier is required",
      });
    }
    if (isReservedAccelerator(binding.accelerator, platform)) {
      issues.push({
        code: "reserved",
        action: binding.action,
        accelerator: binding.accelerator,
        message: "reserved by the operating system; registration may fail",
      });
    }
    const canonical = canonicalizeAccelerator(binding.accelerator);
    if (!canonical) continue;
    const previous = seen.get(canonical);
    if (previous) {
      issues.push({
        code: previous.set === binding.set ? "duplicate" : "set-overlap",
        action: binding.action,
        accelerator: canonical,
        message:
          previous.set === binding.set
            ? 'duplicates "' + previous.action + '" in the same set'
            : 'collides with "' + previous.action + '" from the "' + previous.set + '" set',
      });
    } else {
      seen.set(canonical, binding);
    }
  }
  return issues;
}

export function bindingsForSet(
  bindings: readonly HotkeyBinding[],
  set: HotkeySet,
): readonly HotkeyBinding[] {
  return bindings.filter((binding) => binding.set === set);
}

// ─── Model cycling ──────────────────────────────────────────────────────────

/** Next item in a cycling list (used by the cycle-model hotkey). */
export function cycleValue<T>(values: readonly T[], current: T | null | undefined): T | null {
  if (values.length === 0) return null;
  const index = current == null ? -1 : values.indexOf(current);
  return values[(index + 1) % values.length];
}

export function nextModel(
  models: readonly string[] = DEFAULT_MODEL_CYCLE,
  current: string | null | undefined,
): string | null {
  return cycleValue(models, current);
}
