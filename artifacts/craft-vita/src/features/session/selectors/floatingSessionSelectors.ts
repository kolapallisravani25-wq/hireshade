/**
 * floatingSessionSelectors — memoized selectors for the floatingSession Redux slice.
 *
 * Use these in components via useAppSelector() to avoid unnecessary re-renders
 * by subscribing to only the specific slice of state needed.
 */

import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/store/store";

// ─── Root selector ────────────────────────────────────────────────────────────

const selectFloatingSessionRoot = (state: RootState) => state.floatingSession;

// ─── Primitive / simple selectors (no memoization needed) ────────────────────

export const selectSessionInfo = (state: RootState) =>
  state.floatingSession.sessionInfo;

export const selectSelectedModel = (state: RootState) =>
  state.floatingSession.selectedModel;

export const selectMessages = (state: RootState) =>
  state.floatingSession.messages;

export const selectCreditWarning = (state: RootState) =>
  state.floatingSession.creditWarning;

export const selectIsEnding = (state: RootState) =>
  state.floatingSession.isEnding;

export const selectIsWindowCollapsed = (state: RootState) =>
  state.floatingSession.isWindowCollapsed;

export const selectIsResponsesExpanded = (state: RootState) =>
  state.floatingSession.isResponsesExpanded;

export const selectIsTranscriptExpanded = (state: RootState) =>
  state.floatingSession.isTranscriptExpanded;

export const selectCurrentResponseIndex = (state: RootState) =>
  state.floatingSession.currentResponseIndex;

export const selectAutoGenerate = (state: RootState) =>
  state.floatingSession.autoGenerate;

export const selectAutoScroll = (state: RootState) =>
  state.floatingSession.autoScroll;

// ─── Derived / memoized selectors ────────────────────────────────────────────

/** The most recent transcript message, null when no messages exist */
export const selectLastMessage = createSelector(
  selectMessages,
  (messages) => (messages.length > 0 ? messages[messages.length - 1] : null),
);

/** True when there is an active session */
export const selectHasSession = createSelector(
  selectSessionInfo,
  (info) => info !== null,
);

/** Session ID — convenient shorthand */
export const selectSessionId = createSelector(
  selectSessionInfo,
  (info) => info?.sessionId ?? null,
);

/** Whether the session is a free session */
export const selectIsFreeSession = createSelector(
  selectSessionInfo,
  (info) => info?.isFree ?? false,
);

/** All fields needed to drive the session timer hook — avoids subscribing to the full sessionInfo object */
export const selectTimerParams = createSelector(
  selectSessionInfo,
  (info) => ({
    sessionId: info?.sessionId,
    maxAllowedMinutes: info?.maxAllowedMinutes ?? null,
    startedAt: info?.startedAt ?? null,
  }),
);

/** All fields needed to drive the heartbeat / SSE hooks */
export const selectHeartbeatParams = createSelector(
  selectFloatingSessionRoot,
  ({ sessionInfo }) => ({
    sessionId: sessionInfo?.sessionId,
    // Heartbeat runs for ALL sessions (free included): it is the liveness
    // signal the server's stale-session reaper uses to distinguish a crashed
    // client from a live one, and it enforces the free-session cap server-side.
    enabled: !!(sessionInfo && sessionInfo.startedAt),
    startedAt: sessionInfo?.startedAt ?? null,
  }),
);
