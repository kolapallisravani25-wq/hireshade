import { configureStore } from "@reduxjs/toolkit";
import resumeBuilderReducer from "./resumeBuilderSlice";
import aiProjectsReducer from "./aiProjectsSlice";
import sessionsReducer from "./sessionsSlice";
import settingsReducer from "@/features/settings/slices/settingsSlice";
import overlayReducer from "@/features/launcher/slices/overlaySlice";
import sessionFlowReducer from "@/features/session/slices/sessionFlowSlice";
import floatingSessionReducer from "@/features/session/slices/floatingSessionSlice";
import pricingReducer from "./pricingSlice";

export const store = configureStore({
  reducer: {
    resumeBuilder:   resumeBuilderReducer,
    aiProjects:      aiProjectsReducer,
    sessions:        sessionsReducer,
    settings:        settingsReducer,
    overlay:         overlayReducer,
    sessionFlow:     sessionFlowReducer,
    floatingSession: floatingSessionReducer,
    pricing:         pricingReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
