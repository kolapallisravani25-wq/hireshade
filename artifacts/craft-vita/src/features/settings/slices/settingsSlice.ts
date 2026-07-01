import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  getOpacity,
  getZoom,
  getPrivateMode,
  saveOpacity,
  saveZoom,
  savePrivateMode,
} from "@/lib/overlaySettings";

interface SettingsState {
  zoom: number;
  opacity: number;
  privateMode: boolean;
}

const initialState: SettingsState = {
  zoom: getZoom(),
  opacity: getOpacity(),
  privateMode: getPrivateMode(),
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    setZoom(state, action: PayloadAction<number>) {
      state.zoom = action.payload;
      saveZoom(action.payload);
    },
    setOpacity(state, action: PayloadAction<number>) {
      state.opacity = action.payload;
      saveOpacity(action.payload);
    },
    setPrivateMode(state, action: PayloadAction<boolean>) {
      state.privateMode = action.payload;
      savePrivateMode(action.payload);
    },
  },
});

export const { setZoom, setOpacity, setPrivateMode } = settingsSlice.actions;
export default settingsSlice.reducer;
