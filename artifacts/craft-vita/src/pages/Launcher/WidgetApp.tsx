import "@/lib/disableDebugLogs";
import React, { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Provider } from "react-redux";
import { ClerkProvider } from "@clerk/clerk-react";
import {
  DesktopAuthProvider,
  useDesktopAuth,
} from "@/contexts/DesktopAuthProvider";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { useOverlayShortcuts } from "@/hooks/useOverlayShortcuts";
import { useSafeZoom } from "@/hooks/useSafeZoom";
import { checkForUpdates } from "@/lib/updater";
import { cn } from "@/lib/utils";
import {
  getPrivateMode,
  savePrivateMode,
  OPACITY_MIN,
  OPACITY_MAX,
  ZOOM_STEP,
  ZOOM_DEFAULT,
  OPACITY_DEFAULT,
} from "@/lib/overlaySettings";
import {
  MoreVertical,
  Move,
  ChevronUp,
  ChevronDown,
  X,
  Loader2,
  Info,
  Briefcase,
  FileText,
  Cpu,
  History,
  Sparkles,
  Paperclip,
  Folder,
  Globe,
  Settings,
  Star,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { CompanyAutocomplete } from "@/features/launcher/components/CompanyAutocomplete";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// ─── Feature modules ─────────────────────────────────────────────────────────
import {
  WIDGET_W,
  MORE_ACTIONS_POPOVER_W,
  APP_NAME,
  AI_MODELS_WIDGET,
  JOB_DESCRIPTION_REGEX,
} from "@/features/launcher/constants";
import type { SessionInfo } from "@/features/launcher/types";
import { DEFAULT_SESSION_INFO } from "@/features/launcher/types";
import { useCardPosition } from "@/features/launcher/hooks/useCardPosition";
import { useCursorPassthrough } from "@/features/launcher/hooks/useCursorPassthrough";
import { usePopoverAnchor } from "@/features/launcher/hooks/usePopoverAnchor";
import { useCollapseToggle } from "@/features/launcher/hooks/useCollapseToggle";
import { CollapsedIcon } from "@/features/launcher/components/CollapsedIcon";
import { HeaderMenu } from "@/features/launcher/components/HeaderMenu";
import { TabPills } from "@/features/session/components/TabPills";
import { SessionSelector } from "@/features/session/components/SessionSelector";
import { ActionButtons } from "@/features/session/components/ActionButtons";
import { PastSessionsTab } from "@/features/session/components/PastSessionsTab";
import { AuthScreen } from "@/features/auth/components/AuthScreen";
import { useSessionResources } from "@/features/session/hooks/useSessionResources";
import { useSessionCreation } from "@/features/session/hooks/useSessionCreation";
import { HoverTooltip } from "@/shared/components/HoverTooltip";
import { CreditsBadge } from "@/shared/components/CreditsBadge";
import { WidgetSelect } from "@/shared/components/WidgetSelect";
import { tauriEvents } from "@/services/tauriEvents";
import { tauriOverlay } from "@/services/tauriOverlay";
import { DesktopAuthHydrator } from "@/components/auth/DesktopAuthHydrator";
import { getDesktopClerkOptions } from "@/lib/clerkOptions";

// ─── Redux store ──────────────────────────────────────────────────────────────
import { store } from "@/store/store";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setZoom as setZoom_, setOpacity as setOpacity_, setPrivateMode as setPrivateMode__ } from "@/features/settings/slices/settingsSlice";
import {
  setMenuOpen as reduxSetMenuOpen,
} from "@/features/launcher/slices/overlaySlice";
import {
  setTab,
  setCreationStep,
  setSelectedKind,
  updateSessionInfo,
  resetSessionFlow,
} from "@/features/session/slices/sessionFlowSlice";

import "@/App.css";

import { OverlayRoot, OverlayFlags } from "@/overlay";
import { TooltipProvider } from "@/components/ui/tooltip";

// ─── Constants ────────────────────────────────────────────────────────────────

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// ─── WidgetContent ────────────────────────────────────────────────────────────

function WidgetContent() {
  // Desktop auth (external-browser session) drives the gate — not Clerk. The
  // token lives in the app (localStorage/keychain) instead of a webview cookie,
  // so there's no transient "signed-out" blip and no grace window is needed.
  const { isLoaded, isSignedIn, user } = useDesktopAuth();
  const dispatch = useAppDispatch();

  const showAuthedContent = isLoaded && isSignedIn;

  // ── Redux state ────────────────────────────────────────────────────────────
  const zoom = useAppSelector((s) => s.settings.zoom);
  const opacity = useAppSelector((s) => s.settings.opacity);
  const privateMode = useAppSelector((s) => s.settings.privateMode);
  const menuOpen = useAppSelector((s) => s.overlay.menuOpen);
  const tab = useAppSelector((s) => s.sessionFlow.tab);
  const creationStep = useAppSelector((s) => s.sessionFlow.creationStep);
  const selectedKind = useAppSelector((s) => s.sessionFlow.selectedKind);
  const sessionInfo = useAppSelector((s) => s.sessionFlow.sessionInfo);

  // ── Setters that go through Redux ──────────────────────────────────────────
  const setZoom = useCallback((z: number) => dispatch(setZoom_(z)), [dispatch]);
  const setOpacity = useCallback((v: number) => dispatch(setOpacity_(v)), [dispatch]);
  const setPrivateMode_ = useCallback(
    (v: boolean) => {
      dispatch(setPrivateMode__(v));
      invoke("toggle_content_protection", { protected: v }).catch(console.error);
      // Broadcast to the floating window (separate JS context, no shared Redux).
      tauriEvents.emitPrivateModeChanged(v).catch(console.error);
    },
    [dispatch],
  );

  // ── Refs ────────────────────────────────────────────────────────────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const innerContentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // ── Stable Tauri window handle ─────────────────────────────────────────────
  const win = useMemo(() => getCurrentWindow(), []);

  // ── Credits ───────────────────────────────────────────────────────────────
  const { balance, isLoading: isLoadingBalance, refresh: refreshBalance } = useCreditsBalance();

  // ── Safe zoom bounds ───────────────────────────────────────────────────────
  const { safeMin, safeMax, atMin, atMax } = useSafeZoom(
    innerContentRef,
    zoom,
    setZoom,
    true,
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useOverlayShortcuts({
    opacity,
    setOpacity,
    zoom,
    setZoom,
    privateMode,
    setPrivateMode: setPrivateMode_,
    safeZoomMin: safeMin,
    safeZoomMax: safeMax,
  });

  // ── Card position + drag ───────────────────────────────────────────────────
  const { cardPos, isDraggingRef, handleDragStart } = useCardPosition();

  // ── Cursor passthrough ────────────────────────────────────────────────────
  useCursorPassthrough({ isDraggingRef });

  // ── Collapse toggle ────────────────────────────────────────────────────────
  const {
    collapsed,
    setCollapsed,
    handleCollapseToggle,
    handleCollapsedDragStart,
    handleCollapsedClick,
  } = useCollapseToggle({ handleDragStart });

  // ── Menu anchor ───────────────────────────────────────────────────────────
  const menuAnchor = usePopoverAnchor({
    menuOpen,
    triggerRef,
    cardRef,
    zoom,
    cardPosX: cardPos.x,
    cardPosY: cardPos.y,
    collapsed,
  });

  const handleMenuOpenChange = useCallback(
    (open: boolean) => dispatch(reduxSetMenuOpen(open)),
    [dispatch],
  );

  // ── Session resources ──────────────────────────────────────────────────────
  const {
    resumes,
    documents,
    aiProjects,
    isLoadingResumes,
    isLoadingDocs,
    isLoadingProjects,
    resourcesError,
  } = useSessionResources(isSignedIn, user?.id);

  // ── Session creation ───────────────────────────────────────────────────────
  const {
    isCreating,
    handleCreateSession: createSession,
    conflict,
    clearConflict,
    endConflictAndCreate,
    joinConflictSession,
  } = useSessionCreation();

  // Tracks whether a session is currently active (launched from this window).
  // Used to lock private mode toggle during active sessions (Feature 4).
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [projectSelectionError, setProjectSelectionError] = useState<string>("");
  const selectedProjectCount = sessionInfo.projectIds.length;
  const requiresPrimarySelection =
    selectedProjectCount === 2 && !sessionInfo.primaryProjectId;

  const handleCreateSession = useCallback(
    () => {
      // Only mark session active after the creation flow succeeds.
      // The hook hides the launcher on success; if a conflict dialog appears
      // the launcher stays visible and isSessionActive must stay false.
      const result = createSession(sessionInfo);
      result.then(() => {
        // If no conflict was set, the window was hidden — session is live
        setIsSessionActive(true);
      }).catch(() => {});
      return result;
    },
    [createSession, sessionInfo],
  );

  // ── Helpers ────────────────────────────────────────────────────────────────
  const handleStartFlow = useCallback((isFree: boolean) => {
    dispatch(updateSessionInfo({ isFree }));
    dispatch(setCreationStep(1));
  }, [dispatch]);

  const toggleProjectSelection = useCallback((projectId: string) => {
    const currentlySelected = sessionInfo.projectIds;
    const isSelected = currentlySelected.includes(projectId);

    if (isSelected) {
      const next = currentlySelected.filter((id) => id !== projectId);
      const nextPrimary =
        next.length === 0
          ? ""
          : sessionInfo.primaryProjectId === projectId
            ? next[0]
            : sessionInfo.primaryProjectId || next[0];
      dispatch(updateSessionInfo({ projectIds: next, primaryProjectId: nextPrimary || "" }));
      setProjectSelectionError("");
      return;
    }

    if (currentlySelected.length >= 2) {
      setProjectSelectionError("You can select up to 2 projects. Unselect one to choose another.");
      return;
    }

    const next = [...currentlySelected, projectId];
    const nextPrimary = next.length === 1 ? projectId : sessionInfo.primaryProjectId || "";
    dispatch(updateSessionInfo({ projectIds: next, primaryProjectId: nextPrimary }));
    setProjectSelectionError("");
  }, [dispatch, sessionInfo.primaryProjectId, sessionInfo.projectIds]);

  const setPrimaryProject = useCallback((projectId: string) => {
    if (!sessionInfo.projectIds.includes(projectId)) return;
    dispatch(updateSessionInfo({ primaryProjectId: projectId }));
    setProjectSelectionError("");
  }, [dispatch, sessionInfo.projectIds]);

  const handleClose = useCallback(
    () => win.close().catch(console.error),
    [win],
  );

  // ── On-mount: apply stored private mode ───────────────────────────────────
  useEffect(() => {
    if (getPrivateMode()) {
      invoke("toggle_content_protection", { protected: true }).catch(
        console.error,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-update check + retry policy ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = (attempt: number) => {
      if (cancelled || attempt > 3) return;
      const delayMs = Math.min(60000, 5000 * Math.pow(2, attempt - 1));
      retryTimer = setTimeout(async () => {
        if (cancelled) return;
        const retryResult = await checkForUpdates(false);
        if (retryResult.status === "error") {
          scheduleRetry(attempt + 1);
        }
      }, delayMs);
    };

    const runStartupCheck = async () => {
      const result = await checkForUpdates(false);
      if (result.status === "error") {
        scheduleRetry(1);
      }
    };

    runStartupCheck().catch(() => {});

    const sixHoursMs = 6 * 60 * 60 * 1000;
    const jitterMs = Math.floor(Math.random() * 5 * 60 * 1000);
    const periodicTimer = setInterval(() => {
      checkForUpdates(false).catch(() => {});
    }, sixHoursMs + jitterMs);

    return () => {
      cancelled = true;
      clearInterval(periodicTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auth signed-out broadcast ─────────────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    tauriEvents
      .onAuthSignedOut(() => {
        dispatch(resetSessionFlow());
        dispatch(reduxSetMenuOpen(false));
        setCollapsed(false);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.error);
    return () => {
      unlisten?.();
    };
  }, [dispatch, setCollapsed]);

  // ── Private mode cross-window sync ──────────────────────────────────────
  // Launcher and floating are separate JS contexts with no shared Redux store.
  // Listen for changes emitted by the floating window and apply them here.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    tauriEvents
      .onPrivateModeChanged((value) => {
        dispatch(setPrivateMode__(value));
        // Rust protection is already applied by the emitting window via
        // toggle_content_protection (which applies to all windows). No
        // re-invoke needed here.
      })
      .then((fn) => { unlisten = fn; })
      .catch(console.error);
    return () => { unlisten?.(); };
  }, [dispatch]);

  // ── Session ended — reset ALL state to clean defaults ─────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let refreshTimer1: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer2: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer3: ReturnType<typeof setTimeout> | null = null;
    tauriEvents
      .onSessionReset(() => {
        // 1. Reset Redux session creation flow
        dispatch(resetSessionFlow());
        // 2. Clear the session-active lock so private mode toggle is unblocked
        setIsSessionActive(false);
        // 3. Sync Redux settings with what resetOverlaySettings() wrote to localStorage.
        //    Read actual stored value — do NOT hardcode true, which was overriding
        //    the user's preference every time a session ended.
        const storedPrivate = getPrivateMode();
        dispatch(setPrivateMode__(storedPrivate));
        dispatch(setZoom_(ZOOM_DEFAULT));
        dispatch(setOpacity_(OPACITY_DEFAULT));
        // 4. Re-apply content protection in Rust using the actual stored value.
        invoke("toggle_content_protection", { protected: storedPrivate }).catch(console.error);
        // 5. Expand the widget
        setCollapsed(false);
        // 6. Credit deduction is async (BullMQ). Refresh now and retry shortly
        //    after so the launcher badge reflects the final deducted balance.
        refreshBalance();
        refreshTimer1 = setTimeout(() => {
          refreshBalance();
        }, 2500);
        refreshTimer2 = setTimeout(() => {
          refreshBalance();
        }, 5000);
        refreshTimer3 = setTimeout(() => {
          refreshBalance();
        }, 8000);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.error);
    return () => {
      unlisten?.();
      if (refreshTimer1) clearTimeout(refreshTimer1);
      if (refreshTimer2) clearTimeout(refreshTimer2);
      if (refreshTimer3) clearTimeout(refreshTimer3);
    };
  }, [dispatch, refreshBalance, setCollapsed]);


  // ── Windows WebView2 Fallback Recovery for Collapsed Icon ─────────────────
  // When switching from a large card to a tiny icon, the WebView2 compositor
  // can lose the dirty rect if the transparent window temporarily empties
  // during AnimatePresence mode="wait". We force a native re-show and a
  // CSS repaint to ensure the circular floating icon remains visible.
  useEffect(() => {
    if (!(collapsed && "__TAURI__" in window)) return;
    win.show().catch(() => {});
    win.setAlwaysOnTop(true).catch(() => {});
    // Force a tiny layout shift to break the compositor cache
    const timer = setTimeout(() => {
      document.body.style.transform = "translateZ(0)";
      setTimeout(() => {
        document.body.style.transform = "";
      }, 16);
    }, 50);
    return () => clearTimeout(timer);
  }, [collapsed, win]);



  const creditsOk = !!(balance && parseFloat(balance.totalAvailable ?? "0") > 0);

  return (
    // Fullscreen transparent canvas — pointer-events disabled so transparent
    // areas pass mouse events through to the OS.
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        background: "transparent",
        overflow: "visible",
        userSelect: "none",
      }}
    >
      {/* Active-session conflict dialog — shown when server returns ACTIVE_SESSION_EXISTS */}
      <AlertDialog open={!!conflict} onOpenChange={(open) => { if (!open) { clearConflict(); setIsSessionActive(false); } }}>
        <AlertDialogContent style={{ pointerEvents: "auto" }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Session already running</AlertDialogTitle>
            <AlertDialogDescription>
              {conflict?.companyName
                ? <>You have an active session for <strong>{conflict.companyName}</strong>. Do you want to end it and start a new one?</>
                : "You already have an ongoing session. End it to start a new one, or go back to it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { clearConflict(); setIsSessionActive(false); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-zinc-800 text-white hover:bg-zinc-700"
              onClick={() => joinConflictSession()}
            >
              Go to session
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => endConflictAndCreate()}
            >
              End &amp; start new
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Positional shell — shared anchor for both collapsed icon and expanded card */}
      <div
        style={{
          position: "absolute",
          left: cardPos.x,
          top: cardPos.y,
          opacity,
          pointerEvents: "auto",
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {collapsed ? (
            /* ── Collapsed floating icon ──────────────────────────────── */
            <motion.div
              key="collapsed"
              data-interactive
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              style={{ originX: 0, originY: 0 }}
              onMouseDown={handleCollapsedDragStart}
              onClick={handleCollapsedClick}
            >
              <CollapsedIcon />
            </motion.div>
          ) : (
            /* ── Expanded full launcher ───────────────────────────────── */
            <motion.div
              key="expanded"
              data-interactive
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              style={{ originX: 0, originY: 0 }}
            >
      <div
        ref={cardRef}
        className="relative rounded-3xl bg-white shadow-2xl shadow-black/20"
      >
        <div
          ref={innerContentRef}
          style={{
            zoom: zoom,
            width: WIDGET_W,
            transformOrigin: "top left",
          }}
        >
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <div
              className="flex items-center gap-2 flex-1 min-w-0 cursor-default"
              onMouseDown={handleDragStart}
            >
              <HoverTooltip text={APP_NAME}>
                <img
                  src="/src-tauri/icons/icon.png"
                  alt={APP_NAME}
                  className="w-6 h-6 rounded-lg flex-shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </HoverTooltip>
            </div>

            <CreditsBadge />

            <div className="flex items-center gap-0.5 ml-1">
              <button
                    ref={triggerRef}
                    onClick={() => handleMenuOpenChange(!menuOpen)}
                    className={cn(
                      "p-1.5 rounded-xl transition-colors border",
                      menuOpen
                        ? "bg-zinc-100 border-zinc-200 text-zinc-700"
                        : "border-transparent hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600",
                    )}
                    aria-label="Menu"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
              <HoverTooltip text="Drag" side="bottom">
                <button
                  onMouseDown={handleDragStart}
                  className="p-1.5 rounded-xl border border-zinc-200 hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 transition-colors cursor-default"
                >
                  <Move className="w-3.5 h-3.5" />
                </button>
              </HoverTooltip>
              <HoverTooltip
                text={collapsed ? "Expand" : "Collapse"}
                side="bottom"
              >
                <button
                  onClick={handleCollapseToggle}
                  className="p-1.5 rounded-xl border border-zinc-200 hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 transition-colors"
                >
                  {collapsed ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5" />
                  )}
                </button>
              </HoverTooltip>
              <HoverTooltip text="Close" side="bottom">
                <button
                  onClick={handleClose}
                  className="p-1.5 rounded-xl bg-red-500 hover:bg-red-600 text-white transition-colors ml-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </HoverTooltip>
            </div>
          </div>

          {/* ── Body ────────────────────────────────────────────────────────── */}
          <>
              {!isLoaded && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-300" />
                </div>
              )}

              {isLoaded && !showAuthedContent && <AuthScreen />}

              {/*
                Render the authed content whenever Clerk reports signed-in OR
                while a transient signed-out blip (that followed a real sign-in)
                is still within the grace window. Gating on the raw `isSignedIn`
                here unmounted the whole session-creation form the instant a
                background token refresh flipped it false — exactly the "form
                shows for a second then bounces to login" report. Keeping it
                mounted until sign-out is *confirmed* is the per-window
                equivalent of the App.tsx route-guard fix.
              */}
              {showAuthedContent && (
                <>
                  <TabPills tab={tab} onChange={(t) => dispatch(setTab(t))} />

                  <div className="flex-1 overflow-y-auto no-scrollbar">
                    <div className="min-h-full">
                      {tab === "create" ? (
                        <>
                          {creationStep === 0 && (
                            <>
                              <SessionSelector
                                selected={selectedKind}
                                onSelect={(k) => dispatch(setSelectedKind(k))}
                                creditsOk={creditsOk}
                                isLoadingBalance={isLoadingBalance}
                              />
                              <ActionButtons
                                balance={balance}
                                isLoadingBalance={isLoadingBalance}
                                onStart={handleStartFlow}
                              />
                            </>
                          )}

                          {creationStep === 1 && (
                            <div className="p-4 space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                              <div className="space-y-4">
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <Briefcase className="w-4 h-4 text-zinc-600" />
                                    <Label className="text-sm font-bold text-zinc-800">
                                      Company
                                    </Label>
                                    <HoverTooltip text="The name of the company you are interviewing with.">
                                      <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                    </HoverTooltip>
                                  </div>
                                  <CompanyAutocomplete
                                    placeholder="Microsoft..."
                                    value={sessionInfo.companyName}
                                    onChange={(val) =>
                                      dispatch(updateSessionInfo({ companyName: val }))
                                    }
                                    className="rounded-xl border-zinc-200 focus:ring-zinc-500 h-11"
                                  />
                                </div>

                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <FileText className="w-4 h-4 text-zinc-600" />
                                    <Label className="text-sm font-bold text-zinc-800">
                                      Job Description
                                    </Label>
                                    <HoverTooltip text="Paste the job description or title here.">
                                      <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                    </HoverTooltip>
                                  </div>
                                  <Textarea
                                    placeholder="Software Engineer versed in Python, SQL, and AWS..."
                                    value={sessionInfo.jobDescription}
                                    onChange={(e) =>
                                      dispatch(updateSessionInfo({ jobDescription: e.target.value }))
                                    }
                                    className="rounded-xl border-zinc-200 focus:ring-zinc-500 min-h-25 max-h-45 resize-none overflow-y-auto"
                                  />
                                </div>

                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <Paperclip className="w-4 h-4 text-zinc-600" />
                                    <Label className="text-sm font-bold text-zinc-800">
                                      Resume
                                    </Label>
                                    <HoverTooltip text="Select the resume you want to use for this session.">
                                      <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                    </HoverTooltip>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <WidgetSelect
                                      value={sessionInfo.resumeId}
                                      onValueChange={(val) =>
                                        dispatch(updateSessionInfo({ resumeId: val }))
                                      }
                                      placeholder="Select resume"
                                      options={resumes.map((r) => ({
                                        value: r.id,
                                        label: r.filename,
                                      }))}
                                      isLoading={isLoadingResumes}
                                      emptyMessage={
                                        resourcesError
                                          ? `Couldn't load resumes: ${resourcesError}`
                                          : "No resumes uploaded yet"
                                      }
                                      listClassName="max-h-[80px]"
                                    />
                                    {sessionInfo.resumeId && (
                                      <button
                                        onClick={() =>
                                          dispatch(updateSessionInfo({ resumeId: "" }))
                                        }
                                        className="p-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 text-zinc-400 hover:text-zinc-600 transition-colors"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                  {resourcesError && (
                                    <p className="text-[11px] text-red-500">
                                      Couldn&apos;t load resumes: {resourcesError}
                                    </p>
                                  )}
                                </div>

                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <Folder className="w-4 h-4 text-zinc-600" />
                                    <Label className="text-sm font-bold text-zinc-800">
                                      Documents
                                    </Label>
                                    <HoverTooltip text="Additional documents or materials for the session.">
                                      <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                    </HoverTooltip>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <WidgetSelect
                                      value={sessionInfo.documentId}
                                      onValueChange={(val) =>
                                        dispatch(updateSessionInfo({ documentId: val }))
                                      }
                                      placeholder="Select documents"
                                      options={documents.map((d) => ({
                                        value: d.id,
                                        label: d.filename,
                                      }))}
                                      isLoading={isLoadingDocs}
                                      emptyMessage="No documents uploaded yet"
                                      listClassName="max-h-[80px]"
                                    />
                                    {sessionInfo.documentId && (
                                      <button
                                        onClick={() =>
                                          dispatch(updateSessionInfo({ documentId: "" }))
                                        }
                                        className="p-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 text-zinc-400 hover:text-zinc-600 transition-colors"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2 pt-2">
                                <button
                                  onClick={() => dispatch(setCreationStep(0))}
                                  className="py-2.5 rounded-2xl border border-zinc-200 bg-white text-zinc-800 text-sm font-bold hover:bg-zinc-50 transition-all active:scale-[0.98]"
                                >
                                  Back
                                </button>
                                {(() => {
                                  const jdTrimmed =
                                    sessionInfo.jobDescription.trim();
                                  const jdValid =
                                    !jdTrimmed ||
                                    JOB_DESCRIPTION_REGEX.test(jdTrimmed);
                                  const canProceed =
                                    !!sessionInfo.companyName.trim() &&
                                    !!sessionInfo.resumeId &&
                                    jdValid;
                                  const tooltipMsg =
                                    !sessionInfo.companyName.trim()
                                      ? "Enter the company name to continue."
                                      : !sessionInfo.resumeId
                                        ? "Select a resume to continue."
                                        : !jdValid
                                          ? "Job description is too short — add more detail."
                                          : "";
                                  return (
                                    <HoverTooltip
                                      text={tooltipMsg}
                                      side="top"
                                      className="w-full"
                                    >
                                      <button
                                        onClick={() => dispatch(setCreationStep(2))}
                                        disabled={!canProceed}
                                        aria-disabled={!canProceed}
                                        className={cn(
                                          "w-full py-2.5 rounded-2xl text-sm font-bold transition-all active:scale-[0.98]",
                                          canProceed
                                            ? "bg-zinc-900 text-white hover:bg-zinc-800 shadow-lg shadow-black/10"
                                            : "bg-zinc-200 text-zinc-400 cursor-not-allowed",
                                        )}
                                      >
                                        Next
                                      </button>
                                    </HoverTooltip>
                                  );
                                })()}
                              </div>
                            </div>
                          )}

                          {creationStep === 2 && (
                            <div className="p-4 space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <Globe className="w-4 h-4 text-zinc-600" />
                                      <Label className="text-sm font-bold text-zinc-800">
                                        Language
                                      </Label>
                                      <HoverTooltip text="Preferred language for AI responses.">
                                        <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                      </HoverTooltip>
                                    </div>
                                    <WidgetSelect
                                      value={sessionInfo.language}
                                      onValueChange={(val) =>
                                        dispatch(updateSessionInfo({ language: val }))
                                      }
                                      placeholder="Language"
                                      options={[
                                        { value: "English", label: "English" },
                                        { value: "Spanish", label: "Spanish" },
                                        { value: "French", label: "French" },
                                      ]}
                                    />
                                  </div>

                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5">
                                        <Label className="text-sm font-bold text-zinc-800">
                                          Simple Language
                                        </Label>
                                        <HoverTooltip text="Makes AI responses simpler and easier to understand.">
                                          <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                        </HoverTooltip>
                                      </div>
                                      <Switch
                                        checked={sessionInfo.simpleLanguage}
                                        onCheckedChange={(val) =>
                                          dispatch(updateSessionInfo({ simpleLanguage: val }))
                                        }
                                      />
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <Settings className="w-4 h-4 text-zinc-600" />
                                    <Label className="text-sm font-bold text-zinc-800">
                                      Extra Context/Instructions
                                    </Label>
                                    <HoverTooltip text="Provide additional instructions for the AI assistant.">
                                      <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                    </HoverTooltip>
                                  </div>
                                  <Textarea
                                    placeholder="Use javascript, react, nodeJs for code generation"
                                    value={sessionInfo.extraContext}
                                    onChange={(e) =>
                                      dispatch(updateSessionInfo({ extraContext: e.target.value }))
                                    }
                                    className="rounded-xl border-zinc-200 focus:ring-zinc-500 min-h-[60px] resize-none"
                                  />
                                </div>

                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <Cpu className="w-4 h-4 text-zinc-600" />
                                    <Label className="text-sm font-bold text-zinc-800">
                                      AI Model
                                    </Label>
                                    <HoverTooltip text="The AI model that will power your assistant.">
                                      <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                    </HoverTooltip>
                                  </div>
                                  <WidgetSelect
                                    value={sessionInfo.aiModel}
                                    onValueChange={(val) =>
                                      dispatch(updateSessionInfo({ aiModel: val }))
                                    }
                                    placeholder="Select AI model"
                                    options={AI_MODELS_WIDGET}
                                    className="w-full"
                                  />
                                </div>

                                <div className="space-y-3">
                                  {/* <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Sparkles className="w-4 h-4 text-zinc-600" />
                                      <Label className="text-sm font-medium text-zinc-700">
                                        Auto Generate AI Response
                                      </Label>
                                      <HoverTooltip text="Automatically generate responses based on the conversation.">
                                        <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                      </HoverTooltip>
                                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold shadow-sm shadow-emerald-500/10">
                                        New
                                      </span>
                                    </div>
                                    <Switch
                                      checked={sessionInfo.autoGenerateAI}
                                      onCheckedChange={(val) =>
                                        dispatch(updateSessionInfo({ autoGenerateAI: val }))
                                      }
                                    />
                                  </div> */}

                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <History className="w-4 h-4 text-zinc-600" />
                                      <Label className="text-sm font-medium text-zinc-700">
                                        Save Transcript
                                      </Label>
                                      <HoverTooltip text="Save the full conversation transcript for later review.">
                                        <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                      </HoverTooltip>
                                    </div>
                                    <Switch
                                      checked={sessionInfo.saveTranscript}
                                      onCheckedChange={(val) =>
                                        dispatch(updateSessionInfo({ saveTranscript: val }))
                                      }
                                    />
                                  </div>
                                </div>

                                {/* ── AI Projects context ── */}
                                {(aiProjects.length > 0 ||
                                  isLoadingProjects) && (
                                  <div className="space-y-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <Folder className="w-4 h-4 text-zinc-600" />
                                      <Label className="text-sm font-bold text-zinc-800">
                                        AI Projects Context
                                      </Label>
                                      <HoverTooltip text="Select AI-generated projects to include as additional context. The AI will use these as real project experience when answering questions.">
                                        <Info className="w-3 h-3 text-zinc-400 cursor-help" />
                                      </HoverTooltip>
                                      <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold">
                                        Optional
                                      </span>
                                    </div>
                                    {isLoadingProjects ? (
                                      <div className="flex items-center gap-2 text-xs text-zinc-400 py-1">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Loading projects...
                                      </div>
                                    ) : (
                                      <div className="flex flex-col gap-1 max-h-[110px] overflow-y-auto pr-0.5">
                                        {aiProjects.map((proj) => {
                                          const isSelected =
                                            sessionInfo.projectIds.includes(
                                              proj.id,
                                            );
                                          const firstTitle =
                                            proj.projects?.[0]?.projectHeader
                                              ?.title;
                                          const label =
                                            firstTitle ||
                                            proj.position ||
                                            "AI Project";
                                          const isPrimary =
                                            sessionInfo.primaryProjectId === proj.id;
                                          return (
                                            <button
                                              key={proj.id}
                                              type="button"
                                              onClick={() => toggleProjectSelection(proj.id)}
                                              className={cn(
                                                "flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all text-left",
                                                isSelected
                                                  ? "bg-violet-50 border-violet-300 text-violet-800"
                                                  : "bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50",
                                              )}
                                            >
                                              <div
                                                className={cn(
                                                  "w-3.5 h-3.5 rounded-sm border-2 flex-shrink-0 flex items-center justify-center",
                                                  isSelected
                                                    ? "bg-violet-600 border-violet-600"
                                                    : "border-zinc-300",
                                                )}
                                              >
                                                {isSelected && (
                                                  <svg
                                                    className="w-2 h-2 text-white"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth={3}
                                                    viewBox="0 0 12 12"
                                                  >
                                                    <path
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                      d="M2 6l3 3 5-5"
                                                    />
                                                  </svg>
                                                )}
                                              </div>
                                              <span className="truncate">
                                                {label}
                                              </span>
                                              {isSelected && (
                                                <span
                                                  role="button"
                                                  tabIndex={0}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPrimaryProject(proj.id);
                                                  }}
                                                  onKeyDown={(e) => {
                                                    if (e.key === "Enter" || e.key === " ") {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      setPrimaryProject(proj.id);
                                                    }
                                                  }}
                                                  className={cn(
                                                    "ml-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                                    isPrimary
                                                      ? "border-amber-400 bg-amber-100 text-amber-800"
                                                      : "border-zinc-300 bg-white text-zinc-600 hover:border-amber-300",
                                                  )}
                                                >
                                                  <Star className={cn("h-3 w-3", isPrimary ? "fill-amber-500 text-amber-500" : "text-zinc-400")} />
                                                  {isPrimary ? "Primary" : "Set Primary"}
                                                </span>
                                              )}
                                              <span className="ml-auto flex-shrink-0 text-[10px] text-zinc-400">
                                                {proj.projects?.length ?? 0}{" "}
                                                project
                                                {(proj.projects?.length ??
                                                  0) !== 1
                                                  ? "s"
                                                  : ""}
                                              </span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                    <div className="pt-1 space-y-1">
                                      <p className="text-[11px] text-zinc-500">
                                        {selectedProjectCount}/2 selected
                                      </p>
                                      {requiresPrimarySelection && (
                                        <p className="text-[11px] text-amber-600">
                                          Select which one should be the primary project.
                                        </p>
                                      )}
                                      {projectSelectionError && (
                                        <p className="text-[11px] text-red-600">
                                          {projectSelectionError}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div className="grid grid-cols-2 gap-2 pt-2">
                                <button
                                  onClick={() => dispatch(setCreationStep(1))}
                                  className="py-2.5 rounded-2xl border border-zinc-200 bg-white text-zinc-800 text-sm font-bold hover:bg-zinc-50 transition-all active:scale-[0.98]"
                                >
                                  Back
                                </button>
                                <button
                                  onClick={handleCreateSession}
                                  disabled={isCreating || requiresPrimarySelection}
                                  className="py-2.5 rounded-2xl bg-zinc-900 text-white text-sm font-bold hover:bg-zinc-800 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-black/10"
                                >
                                  {isCreating ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    `Create ${sessionInfo.isFree ? "Free" : "Premium"} Session`
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <PastSessionsTab />
                      )}
                    </div>
                  </div>
                </>
              )}
          </>
        </div>
      </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/*
        Fixed portal overlay — renders at document.body, positioned via
        getBoundingClientRect() of the trigger button.
        - NOT inside the zoom container → no scale distortion
        - Fixed within the fullscreen Tauri window → never clipped
        - data-interactive on both backdrop and panel so cursor passthrough
          turns OFF while the menu is visible
      */}
      {menuOpen && menuAnchor && createPortal(
        <>
          {/* Backdrop — captures outside clicks */}
          <div
            data-interactive
            style={{ position: "fixed", inset: 0, zIndex: 9998 }}
            onMouseDown={() => handleMenuOpenChange(false)}
          />
          {/* Menu panel */}
          <div
            data-interactive
            style={{
              position: "fixed",
              top: menuAnchor.top,
              left: menuAnchor.left,
              zIndex: 9999,
              width: MORE_ACTIONS_POPOVER_W,
              borderRadius: 16,
              background: "rgba(255,255,255,0.97)",
              border: "1px solid rgba(0,0,0,0.07)",
              boxShadow: "0 8px 28px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.05)",
              transformOrigin: menuAnchor.direction === "up" ? "bottom center" : "top center",
              animation: menuAnchor.direction === "up"
                ? "menuInUp 140ms cubic-bezier(0.16,1,0.3,1) both"
                : "menuIn 140ms cubic-bezier(0.16,1,0.3,1) both",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <style>{`
              @keyframes menuIn {
                from { opacity: 0; transform: scale(0.95) translateY(-4px); }
                to   { opacity: 1; transform: scale(1) translateY(0); }
              }
              @keyframes menuInUp {
                from { opacity: 0; transform: scale(0.95) translateY(4px); }
                to   { opacity: 1; transform: scale(1) translateY(0); }
              }
              /* Native range slider — clean dark circular thumb */
              input[type="range"].slider-track::-webkit-slider-runnable-track {
                height: 4px;
                border-radius: 9999px;
                background: transparent;
              }
              input[type="range"].slider-track::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 14px;
                height: 14px;
                border-radius: 9999px;
                background: #18181b;
                border: 2px solid #ffffff;
                box-shadow: 0 1px 2px rgba(0,0,0,0.18);
                margin-top: -5px;
                cursor: pointer;
              }
              input[type="range"].slider-track::-moz-range-track {
                height: 4px;
                border-radius: 9999px;
                background: transparent;
              }
              input[type="range"].slider-track::-moz-range-thumb {
                width: 14px;
                height: 14px;
                border-radius: 9999px;
                background: #18181b;
                border: 2px solid #ffffff;
                box-shadow: 0 1px 2px rgba(0,0,0,0.18);
                cursor: pointer;
              }
            `}</style>
            <HeaderMenu
              opacity={opacity}
              setOpacity={setOpacity}
              zoom={zoom}
              setZoom={setZoom}
              privateMode={privateMode}
              setPrivateMode={setPrivateMode_}
              safeMin={safeMin}
              safeMax={safeMax}
              atMin={atMin}
              atMax={atMax}
              sessionLocked={isSessionActive}
            />
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function WidgetApp() {
  if (!PUBLISHABLE_KEY) {
    return <div className="text-xs text-red-500 p-4">Missing Clerk key</div>;
  }

  const content = (
    <Provider store={store}>
      <ClerkProvider
        {...getDesktopClerkOptions()}
        publishableKey={PUBLISHABLE_KEY}
        allowedRedirectProtocols={["tauri:", "http:", "https:"]}
      >
        <DesktopAuthHydrator
          source="launcher"
          loadingFallback={
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-300" />
            </div>
          }
        >
          <DesktopAuthProvider>
            {OverlayFlags.USE_UNIFIED_OVERLAY ? (
              /*
               * Phase 4+: Unified fullscreen overlay runtime.
               * OverlayRoot coordinates LauncherLayer / SessionLayer transitions
               * and provides the OverlayPortalProvider for all menus/popovers.
               * WidgetContent is passed as launcherContent — its JSX is unchanged;
               * only the outer coordination layer changes.
               */
              <OverlayRoot launcherContent={<WidgetContent />} />
            ) : (
              /*
               * Phase 1–3 (current): existing WidgetContent renders directly.
               * Zero behavioral change until USE_UNIFIED_OVERLAY is enabled.
               */
              <WidgetContent />
            )}
          </DesktopAuthProvider>
        </DesktopAuthHydrator>
      </ClerkProvider>
    </Provider>
  );

  return (
    <TooltipProvider delayDuration={0}>
      {content}
    </TooltipProvider>
  );
}

createRoot(document.getElementById("launcher-root")!).render(
  <React.StrictMode>
    <WidgetApp />
  </React.StrictMode>,
);
