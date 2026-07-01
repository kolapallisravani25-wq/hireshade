export type SessionLifecycleState =
  | "idle"
  | "initializing"
  | "recording"
  | "transcribing"
  | "transcript-ready"
  | "processing"
  | "answering"
  | "completed"
  | "failed"
  | "stopping"
  | "cleanup";

export type SessionOperationKind =
  | "start-session"
  | "stop-session"
  | "start-recording"
  | "stop-recording"
  | "transcript-processing"
  | "ai-answer"
  | "cleanup"
  | "window-sync"
  | "analyze-screen";

export type SessionTransitionEvent = {
  from: SessionLifecycleState;
  to: SessionLifecycleState;
  allowed: boolean;
  reason?: string;
  sessionId?: string;
};

export type SessionOperationRecord = {
  sessionId: string;
  requestId: string;
  operationKind: SessionOperationKind;
  startedAt: number;
  controller?: AbortController;
};

const ALLOWED: Record<SessionLifecycleState, SessionLifecycleState[]> = {
  idle: ["initializing"],
  initializing: ["recording", "failed", "stopping", "cleanup"],
  recording: ["transcribing", "processing", "answering", "failed", "stopping", "cleanup"],
  transcribing: ["transcript-ready", "processing", "answering", "failed", "stopping", "cleanup"],
  "transcript-ready": ["processing", "answering", "completed", "failed", "stopping", "cleanup"],
  processing: ["answering", "completed", "failed", "stopping", "cleanup"],
  answering: ["completed", "failed", "stopping", "cleanup", "recording", "transcript-ready"],
  completed: ["cleanup", "idle", "initializing"],
  failed: ["cleanup", "idle", "initializing"],
  stopping: ["cleanup", "idle"],
  cleanup: ["idle", "initializing"],
};

export function createSessionTransitionGuard(
  initialState: SessionLifecycleState,
  logger: (event: SessionTransitionEvent) => void,
) {
  let current = initialState;

  return {
    getState: () => current,
    transition: (next: SessionLifecycleState, reason?: string, sessionId?: string) => {
      const from = current;
      const allowed = ALLOWED[from].includes(next);
      logger({ from, to: next, allowed, reason, sessionId });
      if (!allowed) return false;
      current = next;
      return true;
    },
    forceSet: (next: SessionLifecycleState) => {
      current = next;
    },
  };
}

function key(sessionId: string, operationKind: SessionOperationKind) {
  return `${sessionId}:${operationKind}`;
}

export function createSessionOperationRegistry(
  logger: (event: Record<string, unknown>) => void,
) {
  const inFlight = new Map<string, SessionOperationRecord>();

  return {
    acquire: (
      sessionId: string,
      operationKind: SessionOperationKind,
      requestId: string,
      controller?: AbortController,
    ) => {
      const k = key(sessionId, operationKind);
      const existing = inFlight.get(k);
      if (existing) {
        logger({
          type: "operation_ignored_duplicate",
          sessionId,
          operationKind,
          requestId,
          activeRequestId: existing.requestId,
          ageMs: Date.now() - existing.startedAt,
        });
        return { acquired: false, existing } as const;
      }
      const rec: SessionOperationRecord = {
        sessionId,
        operationKind,
        requestId,
        startedAt: Date.now(),
        controller,
      };
      inFlight.set(k, rec);
      logger({ type: "operation_start", sessionId, operationKind, requestId });
      return { acquired: true, record: rec } as const;
    },
    release: (sessionId: string, operationKind: SessionOperationKind, requestId?: string) => {
      const k = key(sessionId, operationKind);
      const existing = inFlight.get(k);
      if (!existing) return;
      if (requestId && existing.requestId !== requestId) return;
      inFlight.delete(k);
      logger({ type: "operation_complete", sessionId, operationKind, requestId: existing.requestId });
    },
    abort: (sessionId: string, operationKind: SessionOperationKind, reason: string) => {
      const k = key(sessionId, operationKind);
      const existing = inFlight.get(k);
      if (!existing) return;
      existing.controller?.abort();
      inFlight.delete(k);
      logger({
        type: "operation_abort",
        sessionId,
        operationKind,
        requestId: existing.requestId,
        reason,
      });
    },
    abortAllForSession: (sessionId: string, reason: string) => {
      for (const rec of inFlight.values()) {
        if (rec.sessionId !== sessionId) continue;
        rec.controller?.abort();
        logger({
          type: "operation_abort",
          sessionId: rec.sessionId,
          operationKind: rec.operationKind,
          requestId: rec.requestId,
          reason,
        });
      }
      for (const [k, rec] of inFlight.entries()) {
        if (rec.sessionId === sessionId) inFlight.delete(k);
      }
    },
    has: (sessionId: string, operationKind: SessionOperationKind) =>
      inFlight.has(key(sessionId, operationKind)),
    clear: () => {
      inFlight.clear();
    },
  };
}
