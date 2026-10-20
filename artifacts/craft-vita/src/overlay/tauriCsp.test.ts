import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G-012: the Tauri manifest must ship a restrictive, non-null CSP that covers
 * the real desktop dependencies (self, Clerk, Razorpay, our API, Deepgram WSS)
 * and keeps Vite's dev server working through the separate devCsp.
 *
 * This test reads the manifest as data (no Tauri build required), so it runs in
 * plain CI alongside the frontend unit tests.
 */
const tauriConfigPath = path.resolve(import.meta.dirname, "../../src-tauri/tauri.conf.json");

interface TauriConfig {
  app: {
    security: {
      csp: string | null;
      devCsp?: string | null;
    };
  };
}

const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8")) as TauriConfig;
const csp = config.app.security.csp;
const devCsp = config.app.security.devCsp;

function directives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...values] = trimmed.split(/\s+/);
    map.set(name, values);
  }
  return map;
}

describe("Tauri CSP (G-012)", () => {
  it("is set (not null) and has the mandatory directives", () => {
    expect(csp).not.toBeNull();
    expect(typeof csp).toBe("string");
    expect((csp as string).length).toBeGreaterThan(0);

    const parsed = directives(csp as string);
    expect(parsed.get("default-src")).toEqual(["'self'"]);
    expect(parsed.has("frame-src")).toBe(true);
    expect(parsed.has("connect-src")).toBe(true);
    expect(parsed.has("script-src")).toBe(true);
    expect(parsed.has("object-src")).toBe(true);
    expect(parsed.get("object-src")).toEqual(["'none'"]);
  });

  it("covers Clerk, Razorpay, the HireShade API and Deepgram WSS", () => {
    const parsed = directives(csp as string);
    const connect = parsed.get("connect-src") ?? [];
    const script = parsed.get("script-src") ?? [];
    const frame = parsed.get("frame-src") ?? [];
    const img = parsed.get("img-src") ?? [];

    expect(connect).toContain("https://clerk.hireshade.com");
    expect(connect.some((value) => value.includes("hireshade.com"))).toBe(true);
    expect(connect).toContain("https://api.razorpay.com");
    expect(connect).toContain("wss://api.deepgram.com");
    // Tauri v2 IPC needs the ipc: scheme on Windows/Android and the host form.
    expect(connect).toContain("ipc:");
    expect(connect).toContain("http://ipc.localhost");
    // Native-audio WebSockets are served from random localhost ports.
    expect(connect.some((value) => value.startsWith("ws://127.0.0.1:"))).toBe(true);

    expect(script).toContain("https://checkout.razorpay.com");
    expect(script.some((value) => value.includes("clerk"))).toBe(true);

    expect(frame).toContain("https://checkout.razorpay.com");
    expect(frame).toContain("https://api.razorpay.com");
    expect(img.some((value) => value.includes("clerk"))).toBe(true);
  });

  it("does not allow eval or broad remote script execution in production", () => {
    const script = directives(csp as string).get("script-src") ?? [];
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain("https:");
    expect(script).not.toContain("*");
  });

  it("provides a permissive devCsp so Vite HMR keeps working", () => {
    expect(devCsp).not.toBeNull();
    expect(typeof devCsp).toBe("string");
    const parsed = directives(devCsp as string);
    const script = parsed.get("script-src") ?? [];
    const connect = parsed.get("connect-src") ?? [];
    expect(script).toContain("'unsafe-eval'");
    expect(script).toContain("'unsafe-inline'");
    expect(connect).toContain("ws://localhost:5173");
    expect(connect).toContain("ws://127.0.0.1:5173");
  });
});
