import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/utils";
import {
  clearDesktopClerkSessionId,
  getDesktopClerkSessionId,
  saveDesktopClerkSessionId,
} from "@/lib/desktopClerkSession";

export interface DesktopAuthStateChangedPayload {
  source?: string;
  sessionId: string | null;
  signedIn: boolean;
  emittedAt: string;
}

export async function readPersistedDesktopSession(): Promise<string | null> {
  if (!isTauri()) {
    return getDesktopClerkSessionId();
  }

  try {
    const sessionId = await invoke<string | null>("auth_get_persisted_session");
    if (sessionId) saveDesktopClerkSessionId(sessionId);
    return sessionId;
  } catch {
    return getDesktopClerkSessionId();
  }
}

export async function persistDesktopSession(sessionId: string): Promise<void> {
  saveDesktopClerkSessionId(sessionId);

  if (!isTauri()) return;
  await invoke("auth_set_persisted_session", { sessionId });
}

export async function clearPersistedDesktopSession(): Promise<void> {
  clearDesktopClerkSessionId();

  if (!isTauri()) return;
  await invoke("auth_clear_persisted_session");
}

export async function emitDesktopAuthStateChanged(params: {
  source: string;
  sessionId: string | null;
  signedIn: boolean;
}): Promise<void> {
  if (!isTauri()) return;

  await invoke("auth_emit_state_changed", {
    source: params.source,
    sessionId: params.sessionId,
    signedIn: params.signedIn,
  });
}

export function listenDesktopAuthStateChanged(
  cb: (payload: DesktopAuthStateChangedPayload) => void,
): Promise<UnlistenFn> {
  return listen<DesktopAuthStateChangedPayload>("auth:state-changed", (event) => cb(event.payload));
}
