import React, { useCallback } from "react";
import { useUser, useClerk } from "@clerk/clerk-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  LayoutDashboard,
  ExternalLink,
  User as UserIcon,
  LogOut,
  Plus,
  Minus,
  RotateCcw,
  Info,
  Lock,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  OPACITY_MIN,
  OPACITY_MAX,
  ZOOM_STEP,
  savePrivateMode,
  saveOpacity,
} from "@/lib/overlaySettings";
import { HoverTooltip } from "@/shared/components/HoverTooltip";
import { FRONTEND_URL } from "@/features/launcher/constants";

interface HeaderMenuProps {
  opacity: number;
  setOpacity: (v: number) => void;
  zoom: number;
  setZoom: (z: number) => void;
  privateMode: boolean;
  setPrivateMode: (v: boolean) => void;
  safeMin: number;
  safeMax: number;
  atMin: boolean;
  atMax: boolean;
  /** When true, private mode toggle is locked (active session in progress). */
  sessionLocked?: boolean;
  /**
   * When provided, renders an additional "End Session" row at the bottom.
   * Used by the floating session overlay to give users a quick exit point
   * from the same shared popover.
   */
  onEndSession?: () => void;
}

export function HeaderMenu({
  opacity,
  setOpacity,
  zoom,
  setZoom,
  privateMode,
  setPrivateMode,
  safeMin,
  safeMax,
  atMin,
  atMax,
  sessionLocked = false,
  onEndSession,
}: HeaderMenuProps) {
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  const handlePrivate = useCallback(
    (v: boolean) => {
      setPrivateMode(v);
      savePrivateMode(v);
      invoke("toggle_content_protection", { protected: v }).catch(console.error);
    },
    [setPrivateMode],
  );

  const adjustZoom = useCallback(
    (delta: number) => {
      const next = Math.min(
        safeMax,
        Math.max(safeMin, +(zoom + delta).toFixed(2)),
      );
      setZoom(next);
    },
    [zoom, setZoom, safeMin, safeMax],
  );

  const resetZoom = useCallback(() => setZoom(1), [setZoom]);

  const adjustOpacity = useCallback(
    (delta: number) => {
      const next = Math.min(
        OPACITY_MAX,
        Math.max(OPACITY_MIN, +(opacity + delta).toFixed(2)),
      );
      setOpacity(next);
    },
    [opacity, setOpacity],
  );

  const resetOpacity = useCallback(() => setOpacity(1), [setOpacity]);

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress;

  const btn =
    "grid h-[28px] w-[28px] place-items-center rounded-lg bg-white border border-zinc-200/80 text-zinc-500 transition-colors duration-100 hover:bg-zinc-100 hover:text-zinc-700 active:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-30 flex-shrink-0";
  const row =
    "flex h-[38px] w-full items-center justify-between gap-2 px-3 hover:bg-zinc-50/80 transition-colors duration-100";
  const lbl = "text-[13px] font-semibold leading-none text-zinc-800";
  const val = "text-[12px] font-medium leading-none text-zinc-400 ml-1";
  const sep = <div className="mx-0 h-px bg-zinc-100" />;

  return (
    <div className="py-1">
      {/* ── Email ─────────────────────────────────────────────────────── */}
      {isSignedIn && email && (
        <>
          <div className="flex h-[38px] items-center gap-2 px-3">
            <UserIcon className="h-3.5 w-3.5 flex-shrink-0 text-zinc-300" />
            <span className="truncate text-[12px] font-medium leading-none text-zinc-400">
              {email}
            </span>
          </div>
          {sep}
        </>
      )}

      {/* ── Dashboard ─────────────────────────────────────────────────── */}
      <button
        onClick={() =>
          openUrl(`${FRONTEND_URL}/dashboard`).catch(console.error)
        }
        className={row}
      >
        <div className="flex min-w-0 items-center gap-2">
          <LayoutDashboard className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
          <span className={lbl}>Dashboard</span>
        </div>
        <ExternalLink className="h-3 w-3 text-zinc-300 flex-shrink-0" />
      </button>

      {sep}

      {/* ── Opacity ───────────────────────────────────────────────────── */}
      <div className="px-3 py-2">
        <div className="flex h-[28px] items-center justify-between gap-2">
          <div className="flex min-w-0 items-center">
            <span className={lbl}>Opacity</span>
            <span className={val}>{Math.round(opacity * 100)}%</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => adjustOpacity(-0.05)} className={btn}>
              <Minus className="h-[10px] w-[10px]" />
            </button>
            <button onClick={resetOpacity} className={btn}>
              <RotateCcw className="h-[10px] w-[10px]" />
            </button>
            <button onClick={() => adjustOpacity(0.05)} className={btn}>
              <Plus className="h-[10px] w-[10px]" />
            </button>
          </div>
        </div>
        <input
          type="range"
          min={OPACITY_MIN}
          max={OPACITY_MAX}
          step={0.01}
          value={opacity}
          onChange={(e) => setOpacity(parseFloat(e.target.value))}
          onMouseUp={(e) =>
            saveOpacity(parseFloat((e.target as HTMLInputElement).value))
          }
          className="slider-track mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background: `linear-gradient(to right, #18181b 0%, #18181b ${
              ((opacity - OPACITY_MIN) / (OPACITY_MAX - OPACITY_MIN)) * 100
            }%, #e4e4e7 ${
              ((opacity - OPACITY_MIN) / (OPACITY_MAX - OPACITY_MIN)) * 100
            }%, #e4e4e7 100%)`,
          }}
        />
      </div>

      {sep}

      {/* ── Zoom ──────────────────────────────────────────────────────── */}
      <div className={row}>
        <div className="flex min-w-0 items-center">
          <span className={lbl}>Zoom</span>
          <span className={val}>{Math.round(zoom * 100)}%</span>
          {(atMin || atMax) && (
            <span className="ml-1.5 text-[10px] font-medium text-amber-500">
              {atMin ? "Min" : "Max"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => adjustZoom(ZOOM_STEP)}
            disabled={atMax}
            className={btn}
          >
            <Plus className="h-[10px] w-[10px]" />
          </button>
          <button
            onClick={() => adjustZoom(-ZOOM_STEP)}
            disabled={atMin}
            className={btn}
          >
            <Minus className="h-[10px] w-[10px]" />
          </button>
          <button onClick={resetZoom} className={btn}>
            <RotateCcw className="h-[10px] w-[10px]" />
          </button>
        </div>
      </div>

      {sep}

      {/* ── Private ───────────────────────────────────────────────────── */}
      <div className={row}>
        <div className="flex items-center gap-1.5">
          <span className={lbl}>Private</span>
          {sessionLocked ? (
            <HoverTooltip
              text="Private mode cannot be changed during an active session."
              side="bottom"
            >
              <Lock className="h-3 w-3 cursor-default text-amber-400" />
            </HoverTooltip>
          ) : (
            <HoverTooltip
              text="Hides HireShade from screen recording and sharing."
              side="bottom"
            >
              <Info className="h-3 w-3 cursor-default text-zinc-300" />
            </HoverTooltip>
          )}
        </div>
        <Switch
          checked={privateMode}
          onCheckedChange={sessionLocked ? undefined : handlePrivate}
          disabled={sessionLocked}
          className={sessionLocked ? "opacity-50 cursor-not-allowed" : ""}
        />
      </div>

      {/* ── Logout ────────────────────────────────────────────────────── */}
      {isSignedIn && (
        <>
          {sep}
          <button
            onClick={async () => {
              localStorage.removeItem("userId");
              await signOut({ redirectUrl: window.location.href }).catch(
                console.error,
              );
            }}
            className="flex h-[38px] w-full items-center gap-2 px-3 text-red-500 transition-colors duration-100 hover:bg-red-50"
          >
            <LogOut className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="text-[13px] font-semibold leading-none">
              Logout
            </span>
          </button>
        </>
      )}

      {/* ── End Session (only shown when onEndSession is provided) ─────── */}
      {onEndSession && (
        <>
          {sep}
          <button
            onClick={onEndSession}
            className="flex h-[38px] w-full items-center gap-2 px-3 text-rose-600 transition-colors duration-100 hover:bg-rose-50"
          >
            <LogOut className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="text-[13px] font-semibold leading-none">
              End Session
            </span>
          </button>
        </>
      )}
    </div>
  );
}
