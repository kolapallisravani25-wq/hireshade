import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { DEFAULT_SESSION_INFO } from "@/features/launcher/types";
import type { Tab, SessionKind, SessionInfo } from "@/features/launcher/types";

interface SessionFlowState {
  tab: Tab;
  creationStep: 0 | 1 | 2;
  selectedKind: SessionKind;
  sessionInfo: SessionInfo;
}

const initialState: SessionFlowState = {
  tab: "create",
  creationStep: 0,
  selectedKind: "premium",
  sessionInfo: DEFAULT_SESSION_INFO,
};

const sessionFlowSlice = createSlice({
  name: "sessionFlow",
  initialState,
  reducers: {
    setTab(state, action: PayloadAction<Tab>) {
      state.tab = action.payload;
    },
    setCreationStep(state, action: PayloadAction<0 | 1 | 2>) {
      state.creationStep = action.payload;
    },
    setSelectedKind(state, action: PayloadAction<SessionKind>) {
      state.selectedKind = action.payload;
    },
    updateSessionInfo(state, action: PayloadAction<Partial<SessionInfo>>) {
      state.sessionInfo = { ...state.sessionInfo, ...action.payload };
    },
    resetSessionFlow(state) {
      state.tab = "create";
      state.creationStep = 0;
      state.selectedKind = "premium";
      state.sessionInfo = DEFAULT_SESSION_INFO;
    },
  },
});

export const {
  setTab,
  setCreationStep,
  setSelectedKind,
  updateSessionInfo,
  resetSessionFlow,
} = sessionFlowSlice.actions;
export default sessionFlowSlice.reducer;
