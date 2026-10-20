import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_HOTKEYS,
  DEFAULT_HOTKEYS,
  DEFAULT_MODEL_CYCLE,
  DESKTOP_IPC,
  HOTKEY_EVENT_CHANNEL,
  LIVE_CALL_HOTKEYS,
  POINTER_PASS_THROUGH_CHANNEL,
  bindingsForSet,
  canonicalizeAccelerator,
  cycleValue,
  findConflicts,
  formatAccelerator,
  isReservedAccelerator,
  keyEventToAccelerator,
  matchesKeyboardEvent,
  nextModel,
  normalizeKey,
  normalizePlatform,
  resolveHotkeys,
  tryParseAccelerator,
  validateAccelerator,
  type HotkeyBinding,
} from "./hotkeys";

const winEvent = (key: string, extra: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key,
  ctrlKey: extra.ctrlKey ?? false,
  metaKey: extra.metaKey ?? false,
  altKey: extra.altKey ?? false,
  shiftKey: extra.shiftKey ?? false,
});

describe("hotkey defaults", () => {
  it("defines the three HireShade safety hotkeys in the app set", () => {
    const accelerators = APP_HOTKEYS.map((binding) => binding.accelerator);
    expect(accelerators).toContain("CommandOrControl+Shift+H");
    expect(accelerators).toContain("CommandOrControl+Shift+X");
    expect(accelerators).toContain("CommandOrControl+Shift+M");
  });

  it("keeps the target app/live-call split (T-07)", () => {
    const app = APP_HOTKEYS.map((binding) => binding.accelerator);
    expect(app).toEqual(
      expect.arrayContaining([
        "CommandOrControl+Shift+Up",
        "CommandOrControl+Shift+Down",
        "CommandOrControl+Shift+Left",
        "CommandOrControl+Shift+Right",
      ]),
    );
    const live = LIVE_CALL_HOTKEYS.map((binding) => binding.accelerator);
    expect(live).toEqual(
      expect.arrayContaining([
        "CommandOrControl+Enter",
        "CommandOrControl+Shift+Enter",
        "CommandOrControl+H",
        "CommandOrControl+Up",
        "CommandOrControl+Down",
        "CommandOrControl+Left",
        "CommandOrControl+Right",
      ]),
    );
  });

  it("has unique action ids and registers no conflicting default bindings", () => {
    const actions = DEFAULT_HOTKEYS.map((binding) => binding.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(findConflicts(DEFAULT_HOTKEYS, "win")).toEqual([]);
  });

  it("isolates binding sets", () => {
    expect(bindingsForSet(DEFAULT_HOTKEYS, "app")).toHaveLength(APP_HOTKEYS.length);
    expect(APP_HOTKEYS.every((binding) => binding.set === "app")).toBe(true);
    expect(LIVE_CALL_HOTKEYS.every((binding) => binding.set === "live-call")).toBe(true);
  });
});

describe("accelerator parsing", () => {
  it("parses CommandOrControl and aliases", () => {
    const parsed = tryParseAccelerator("CommandOrControl+Shift+H");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.modifiers).toEqual(["primary", "shift"]);
      expect(parsed.value.key).toBe("H");
    }
    const alias = tryParseAccelerator("ctrl+alt+delete");
    expect(alias.ok).toBe(true);
    if (alias.ok) {
      expect(alias.value.modifiers).toEqual(["control", "alt"]);
      expect(alias.value.key).toBe("Delete");
    }
  });

  it("parses arrow keys, function keys and plus", () => {
    const arrow = tryParseAccelerator("CmdOrCtrl+Up");
    expect(arrow.ok).toBe(true);
    if (arrow.ok) expect(arrow.value.key).toBe("ArrowUp");
    const fkey = tryParseAccelerator("Alt+F12");
    expect(fkey.ok).toBe(true);
    if (fkey.ok) expect(fkey.value.key).toBe("F12");
    const plus = tryParseAccelerator("CommandOrControl++");
    expect(plus.ok).toBe(true);
    if (plus.ok) expect(plus.value.key).toBe("Plus");
  });

  it("rejects malformed accelerators", () => {
    expect(tryParseAccelerator("").ok).toBe(false);
    expect(tryParseAccelerator("Ctrl+").ok).toBe(false);
    expect(tryParseAccelerator("Ctrl+Banana").ok).toBe(false);
    expect(tryParseAccelerator("Hyper+H").ok).toBe(false);
  });

  it("canonicalizes modifier order and spelling", () => {
    expect(canonicalizeAccelerator("shift+ctrl+h")).toBe("Control+Shift+H");
    expect(canonicalizeAccelerator("CMD+Option+Shift+Space")).toBe("Meta+Alt+Shift+Space");
    expect(canonicalizeAccelerator("banana")).toBeNull();
  });

  it("normalizes keys", () => {
    expect(normalizeKey("a")).toBe("A");
    expect(normalizeKey(" ")).toBe("Space");
    expect(normalizeKey("esc")).toBe("Escape");
    expect(normalizeKey("return")).toBe("Enter");
    expect(normalizeKey("pgup")).toBe("PageUp");
    expect(normalizeKey("not-a-key")).toBeNull();
  });

  it("normalizes platforms", () => {
    expect(normalizePlatform("darwin")).toBe("mac");
    expect(normalizePlatform("win32")).toBe("win");
    expect(normalizePlatform("linux")).toBe("linux");
    expect(normalizePlatform(undefined)).toBe("win");
  });
});

describe("keyboard event matching", () => {
  it("matches the same accelerator on Windows and macOS", () => {
    const accelerator = "CommandOrControl+Shift+H";
    expect(matchesKeyboardEvent(winEvent("H", { ctrlKey: true, shiftKey: true }), accelerator, "win")).toBe(true);
    expect(matchesKeyboardEvent(winEvent("h", { metaKey: true, shiftKey: true }), accelerator, "mac")).toBe(true);
  });

  it("requires an exact modifier set", () => {
    const accelerator = "CommandOrControl+Shift+H";
    expect(matchesKeyboardEvent(winEvent("H", { ctrlKey: true }), accelerator, "win")).toBe(false);
    expect(
      matchesKeyboardEvent(winEvent("H", { ctrlKey: true, shiftKey: true, altKey: true }), accelerator, "win"),
    ).toBe(false);
    expect(matchesKeyboardEvent(winEvent("J", { ctrlKey: true, shiftKey: true }), accelerator, "win")).toBe(false);
  });

  it("treats Plus and = as the same physical key", () => {
    const accelerator = "CommandOrControl++";
    expect(matchesKeyboardEvent(winEvent("+", { ctrlKey: true }), accelerator, "win")).toBe(true);
    expect(matchesKeyboardEvent(winEvent("=", { ctrlKey: true }), accelerator, "win")).toBe(true);
  });

  it("converts keyboard events back to accelerators", () => {
    expect(keyEventToAccelerator(winEvent("h", { ctrlKey: true, shiftKey: true }), "win")).toBe(
      "CommandOrControl+Shift+H",
    );
    expect(keyEventToAccelerator(winEvent("h", { metaKey: true, shiftKey: true }), "mac")).toBe(
      "CommandOrControl+Shift+H",
    );
    expect(keyEventToAccelerator(winEvent("ArrowUp", { ctrlKey: true }), "win")).toBe(
      "CommandOrControl+ArrowUp",
    );
    expect(keyEventToAccelerator(winEvent("h"), "win")).toBeNull();
    expect(keyEventToAccelerator(winEvent("Shift", { shiftKey: true }), "win")).toBeNull();
  });
});

describe("display formatting", () => {
  it("formats PC and macOS accelerators", () => {
    expect(formatAccelerator("CommandOrControl+Shift+H", "win")).toBe("Ctrl + Shift + H");
    expect(formatAccelerator("CommandOrControl+Shift+H", "mac")).toBe("\u2318 \u21E7 H");
    expect(formatAccelerator("CommandOrControl+Up", "win")).toBe("Ctrl + \u2191");
  });
});

describe("validation and conflicts", () => {
  it("flags reserved OS hotkeys as warnings, not hard errors", () => {
    expect(isReservedAccelerator("Alt+F4", "win")).toBe(true);
    expect(isReservedAccelerator("Command+H", "mac")).toBe(true);
    expect(isReservedAccelerator("CommandOrControl+Shift+H", "win")).toBe(false);
    const validation = validateAccelerator("Command+H", "mac");
    expect(validation.ok).toBe(true);
    expect(validation.warnings.length).toBeGreaterThan(0);
  });

  it("rejects modifier-less accelerators", () => {
    const validation = validateAccelerator("H", "win");
    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toMatch(/modifier/);
  });

  it("applies valid overrides and keeps the default for invalid ones", () => {
    const resolved = resolveHotkeys({ "toggle-overlay": "CommandOrControl+Alt+T" }, "win");
    const toggle = resolved.bindings.find((binding) => binding.action === "toggle-overlay");
    expect(toggle?.accelerator).toBe("CommandOrControl+Alt+T");
    expect(resolved.issues).toEqual([]);

    const invalid = resolveHotkeys({ "panic-hide": "Banana" }, "win");
    const panic = invalid.bindings.find((binding) => binding.action === "panic-hide");
    expect(panic?.accelerator).toBe("CommandOrControl+Shift+X");
    expect(invalid.issues.some((issue) => issue.code === "invalid")).toBe(true);
  });

  it("detects duplicate and cross-set collisions introduced by overrides", () => {
    const duplicate = resolveHotkeys({ "panic-hide": "CommandOrControl+Shift+H" }, "win");
    expect(duplicate.issues.some((issue) => issue.code === "duplicate")).toBe(true);

    const overlap = resolveHotkeys({ "cycle-model": "CommandOrControl+Enter" }, "win");
    expect(overlap.issues.some((issue) => issue.code === "set-overlap")).toBe(true);
  });

  it("detects invalid bindings passed directly to findConflicts", () => {
    const bindings: HotkeyBinding[] = [
      { action: "toggle-overlay", set: "app", accelerator: "Banana", label: "x", description: "x" },
      { action: "panic-hide", set: "app", accelerator: "H", label: "x", description: "x" },
    ];
    const issues = findConflicts(bindings, "win");
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["invalid", "missing-modifier"]),
    );
  });
});

describe("model cycling", () => {
  it("cycles through the model list", () => {
    expect(nextModel(DEFAULT_MODEL_CYCLE, null)).toBe(DEFAULT_MODEL_CYCLE[0]);
    expect(nextModel(DEFAULT_MODEL_CYCLE, DEFAULT_MODEL_CYCLE[0])).toBe(DEFAULT_MODEL_CYCLE[1]);
    expect(nextModel(DEFAULT_MODEL_CYCLE, DEFAULT_MODEL_CYCLE[DEFAULT_MODEL_CYCLE.length - 1])).toBe(
      DEFAULT_MODEL_CYCLE[0],
    );
    expect(nextModel(DEFAULT_MODEL_CYCLE, "unknown/model")).toBe(DEFAULT_MODEL_CYCLE[0]);
    expect(nextModel([], "x")).toBeNull();
    expect(cycleValue([1, 2, 3], 2)).toBe(3);
  });
});

describe("electron bridge contract", () => {
  const electronRoot = path.resolve(import.meta.dirname, "../../../desktop-electron");

  it("mirrors every IPC channel in preload.js", () => {
    const preload = fs.readFileSync(path.join(electronRoot, "preload.js"), "utf8");
    for (const channel of Object.values(DESKTOP_IPC)) {
      expect(preload).toContain('"' + channel + '"');
    }
    expect(preload).toContain('"' + HOTKEY_EVENT_CHANNEL + '"');
    expect(preload).toContain('"' + POINTER_PASS_THROUGH_CHANNEL + '"');
    expect(preload).toContain("contextBridge.exposeInMainWorld");
    expect(preload).toContain("contextIsolation");
  });

  it("compiles the pure modules into desktop-electron/lib for main.js", () => {
    const buildScript = fs.readFileSync(
      path.join(electronRoot, "scripts/build-main-helpers.js"),
      "utf8",
    );
    expect(buildScript).toContain("src/overlay/hotkeys.ts");
    expect(buildScript).toContain("src/overlay/overlayGeometry.ts");
  });
});
