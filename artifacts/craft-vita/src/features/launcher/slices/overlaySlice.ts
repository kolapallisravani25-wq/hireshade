import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { OverlayMode } from "@/overlay/types";

interface MenuAnchor {
  top: number;
  left: number;
}

interface OverlayState {
  collapsed: boolean;
  menuOpen: boolean;
  menuAnchor: MenuAnchor | null;
  /**
   * Unified overlay mode — switches visible layer inside OverlayRoot.
   * Only meaningful when USE_UNIFIED_OVERLAY feature flag is enabled.
   * Defaults to "launcher" to preserve existing behavior.
   */
  mode: OverlayMode;
  /**
   * ID of the currently open popover for mutual exclusion.
   * null when no popover is open.
   */
  activePopover: string | null;
  /**
   * True once a session has been started from this launcher instance.
   * Used to lock private mode toggle during active sessions.
   */
  sessionActive: boolean;
}

const initialState: OverlayState = {
  collapsed: false,
  menuOpen: false,
  menuAnchor: null,
  mode: "launcher",
  activePopover: null,
  sessionActive: false,
};

const overlaySlice = createSlice({
  name: "overlay",
  initialState,
  reducers: {
    setCollapsed(state, action: PayloadAction<boolean>) {
      state.collapsed = action.payload;
    },
    toggleCollapsed(state) {
      state.collapsed = !state.collapsed;
    },
    setMenuOpen(state, action: PayloadAction<boolean>) {
      state.menuOpen = action.payload;
      if (!action.payload) {
        state.menuAnchor = null;
      }
    },
    setMenuAnchor(state, action: PayloadAction<MenuAnchor | null>) {
      state.menuAnchor = action.payload;
    },
    /** Switch the active overlay layer (launcher ↔ session) */
    setOverlayMode(state, action: PayloadAction<OverlayMode>) {
      state.mode = action.payload;
    },
    /** Open or close a named popover; closing sets activePopover to null */
    setActivePopover(state, action: PayloadAction<string | null>) {
      state.activePopover = action.payload;
    },
    /** Mark that a session is now active (locks private mode) */
    setSessionActive(state, action: PayloadAction<boolean>) {
      state.sessionActive = action.payload;
    },
  },
});

export const {
  setCollapsed,
  toggleCollapsed,
  setMenuOpen,
  setMenuAnchor,
  setOverlayMode,
  setActivePopover,
  setSessionActive,
} = overlaySlice.actions;
export default overlaySlice.reducer;
