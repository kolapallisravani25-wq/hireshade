import { useEffect, useCallback, useState } from "react";
import { X, SlidersHorizontal } from "lucide-react";
import { useUser, useAuth } from "@clerk/clerk-react";
import { InspectAuthContext } from "./InspectAuthContext";
import { InspectTab } from "./InspectTab";
import type { InspectAuthPayload } from "@/services/tauriEvents";

interface InspectDialogProps {
  open: boolean;
  onClose: () => void;
}

export function InspectDialog({ open, onClose }: InspectDialogProps) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const [authPayload, setAuthPayload] = useState<InspectAuthPayload>({
    token: null,
    email: "—",
    userId: "—",
  });

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setAuthPayload({ token: null, email: "—", userId: "—" });
      return;
    }
    let cancelled = false;
    const sync = async () => {
      const token = await getToken();
      if (cancelled) return;
      setAuthPayload({
        token,
        email:
          user?.primaryEmailAddress?.emailAddress ??
          user?.emailAddresses?.[0]?.emailAddress ??
          "—",
        userId: localStorage.getItem("userId") ?? "—",
      });
    };
    sync();
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, getToken, user]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: "calc(100% + 16px)",
        width: 360,
        maxHeight: "calc(100vh - 40px)",
        background: "#ffffff",
        borderRadius: 16,
        boxShadow: "0 8px 40px rgba(0,0,0,0.18), 0 2px 10px rgba(0,0,0,0.08)",
        overflow: "hidden",
        pointerEvents: open ? "auto" : "none",
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        border: "1px solid #e4e4e7",
        // CSS enter/exit — compositor-only, no JS RAF loop
        opacity: open ? 1 : 0,
        transform: open ? "scale(1) translateX(0)" : "scale(0.95) translateX(20px)",
        visibility: open ? "visible" : "hidden",
        transition: "opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      data-interactive
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-zinc-500" />
          <span className="text-sm font-bold text-zinc-800">HireShade – Inspect</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors"
          aria-label="Close Inspect"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <InspectAuthContext.Provider value={authPayload}>
          <InspectTab />
        </InspectAuthContext.Provider>
      </div>
    </div>
  );
}
