import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "./store";
import { getAuthHeaders } from "@/lib/globalAuth";

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionStatus =
  | "PRE_CHECK"
  | "ACTIVE"
  | "COMPLETING"
  | "COMPLETED"
  | "CREDIT_EXHAUSTED"
  | "FORCE_ENDED"
  | "ABANDONED"
  | "AUTO_ENDED";

export interface Session {
  id: string;
  companyName: string;
  jobDescription: string;
  mode: "url" | "manual";
  free: boolean;
  aiUsage?: number;
  status?: SessionStatus | "Ended" | "Active";
  isActive?: boolean;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  autoGenerateResponse: boolean;
  saveTranscription: boolean;
  creditsDeducted?: string | null;
  deductionReason?: string | null;
  company?: { name: string };
}

interface FetchParams {
  userId: string;
  search?: string;
  from_date?: string;
  to_date?: string;
}

interface SessionsState {
  /** All sessions returned by the API (unpaginated) */
  items: Session[];
  /** Loading states */
  status: "idle" | "loading" | "succeeded" | "failed";
  /** Whether we have fetched at least once (prevents skeleton on subsequent fetches) */
  hasFetched: boolean;
  error: string | null;
  /** Tracks the last fetch params to avoid redundant API calls */
  lastFetchKey: string | null;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

// ── Thunks ────────────────────────────────────────────────────────────────────

export const fetchSessions = createAsyncThunk(
  "sessions/fetch",
  async (params: FetchParams, { getState, rejectWithValue }) => {
    const state = getState() as RootState;
    const fetchKey = JSON.stringify(params);

    // Skip fetch if we already have data for these exact params and are not forcing
    if (
      state.sessions.status === "succeeded" &&
      state.sessions.lastFetchKey === fetchKey &&
      state.sessions.items.length >= 0
    ) {
      return { items: state.sessions.items, skipped: true };
    }

    try {
      const qs = new URLSearchParams({ userId: params.userId });
      if (params.search) qs.set("search", params.search);
      if (params.from_date) qs.set("from_date", params.from_date);
      if (params.to_date) qs.set("to_date", params.to_date);

      const authHeaders = await getAuthHeaders();
      const res = await fetch(`${BACKEND_URL}/api/session/list?${qs}`, {
        method: "GET",
        headers: { "Content-Type": "application/json", ...authHeaders },
      });

      if (!res.ok) throw new Error("Failed to fetch sessions");

      const data = await res.json();
      const items: Session[] = Array.isArray(data) ? data : data.data || [];
      return { items, skipped: false, fetchKey };
    } catch (err: any) {
      return rejectWithValue(err.message || "Unknown error");
    }
  },
);

export const deleteSession = createAsyncThunk(
  "sessions/delete",
  async (id: string, { rejectWithValue }) => {
    try {
      const deleteAuthHeaders = await getAuthHeaders();
      const res = await fetch(`${BACKEND_URL}/api/session/${id}`, {
        method: "DELETE",
        headers: { ...deleteAuthHeaders },
      });
      if (res.status === 409) {
        return rejectWithValue({ status: 409, message: "Session is still active" });
      }
      if (!res.ok) {
        return rejectWithValue({ status: res.status, message: "Failed to delete" });
      }
      return id;
    } catch (err: any) {
      return rejectWithValue({ status: 500, message: err.message || "Unknown error" });
    }
  },
);

export const forceDeleteSession = createAsyncThunk(
  "sessions/forceDelete",
  async (id: string, { rejectWithValue }) => {
    try {
      // 1. End session gracefully
      const forceAuthHeaders = await getAuthHeaders();
      await fetch(`${BACKEND_URL}/api/session/${id}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...forceAuthHeaders },
        body: JSON.stringify({ transcript: "", aiUsage: 0 }),
      }).catch(() => {});

      // Wait for the background credit-deduction job to finish processing
      // and transition the session out of the COMPLETING state.
      let attempts = 0;
      while (attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const checkRes = await fetch(`${BACKEND_URL}/api/session/${id}`, {
          headers: { ...forceAuthHeaders },
        });
        if (checkRes.ok) {
          const sessionData = await checkRes.json();
          if (
            sessionData.status !== "ACTIVE" &&
            sessionData.status !== "COMPLETING"
          ) {
            break;
          }
        } else {
          // If it 404s or errors, break out to let the delete attempt run
          break;
        }
        attempts++;
      }

      // 2. Delete
      const res = await fetch(`${BACKEND_URL}/api/session/${id}`, {
        method: "DELETE",
        headers: { ...forceAuthHeaders },
      });
      if (!res.ok) {
        return rejectWithValue("Could not delete session");
      }
      return id;
    } catch (err: any) {
      return rejectWithValue(err.message || "Unknown error");
    }
  },
);

export const bulkDeleteSessions = createAsyncThunk(
  "sessions/bulkDelete",
  async (ids: string[]) => {
    const bulkAuthHeaders = await getAuthHeaders();
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`${BACKEND_URL}/api/session/${id}`, { method: "DELETE", headers: { ...bulkAuthHeaders } }),
      ),
    );

    const deleted: string[] = [];
    let blocked = 0;
    let failed = 0;

    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        if (r.value.status === 409) {
          blocked++;
        } else if (r.value.ok) {
          deleted.push(ids[i]);
        } else {
          failed++;
        }
      } else {
        failed++;
      }
    });

    return { deleted, blocked, failed };
  },
);

// ── Slice ─────────────────────────────────────────────────────────────────────

const initialState: SessionsState = {
  items: [],
  status: "idle",
  hasFetched: false,
  error: null,
  lastFetchKey: null,
};

const sessionsSlice = createSlice({
  name: "sessions",
  initialState,
  reducers: {
    /** Force a re-fetch on next dispatch of fetchSessions */
    invalidateSessions(state) {
      state.lastFetchKey = null;
    },
    /** Optimistically remove a session from the local list */
    removeSessionLocally(state, action: PayloadAction<string>) {
      state.items = state.items.filter((s) => s.id !== action.payload);
    },
    /** Optimistically remove multiple sessions from the local list */
    removeSessionsLocally(state, action: PayloadAction<string[]>) {
      const idsSet = new Set(action.payload);
      state.items = state.items.filter((s) => !idsSet.has(s.id));
    },
  },
  extraReducers: (builder) => {
    // ── fetchSessions ───────────────────────────────────────────────────────
    builder.addCase(fetchSessions.pending, (state) => {
      // Only show loading skeleton on the very first fetch.
      // Subsequent fetches keep existing data visible (no flicker).
      if (!state.hasFetched) {
        state.status = "loading";
      }
    });
    builder.addCase(fetchSessions.fulfilled, (state, action) => {
      if (!action.payload.skipped) {
        state.items = action.payload.items as Session[];
        state.lastFetchKey = (action.payload as any).fetchKey ?? null;
      }
      state.status = "succeeded";
      state.hasFetched = true;
      state.error = null;
    });
    builder.addCase(fetchSessions.rejected, (state, action) => {
      state.status = "failed";
      state.error = action.payload as string;
    });

    // ── deleteSession ───────────────────────────────────────────────────────
    builder.addCase(deleteSession.fulfilled, (state, action) => {
      state.items = state.items.filter((s) => s.id !== action.payload);
    });

    // ── forceDeleteSession ──────────────────────────────────────────────────
    builder.addCase(forceDeleteSession.fulfilled, (state, action) => {
      state.items = state.items.filter((s) => s.id !== action.payload);
    });

    // ── bulkDeleteSessions ──────────────────────────────────────────────────
    builder.addCase(bulkDeleteSessions.fulfilled, (state, action) => {
      const deletedSet = new Set(action.payload.deleted);
      state.items = state.items.filter((s) => !deletedSet.has(s.id));
    });
  },
});

export const { invalidateSessions, removeSessionLocally, removeSessionsLocally } =
  sessionsSlice.actions;

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectSessionItems = (state: RootState) => state.sessions.items;
export const selectSessionsStatus = (state: RootState) => state.sessions.status;
export const selectSessionsHasFetched = (state: RootState) => state.sessions.hasFetched;
export const selectSessionsError = (state: RootState) => state.sessions.error;

export default sessionsSlice.reducer;
