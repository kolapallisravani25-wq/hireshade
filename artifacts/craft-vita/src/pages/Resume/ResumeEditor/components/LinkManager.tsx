import React, { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import { updateField } from "@/store/resumeBuilderSlice";
import { ChevronUp, ChevronDown, ExternalLink, Trash2, Plus, Lock } from "lucide-react";
import { PLATFORM_CONFIGS, LinkEntry, serializeLinks, deserializeLinks } from "../types";

export const LinkManager = React.memo(function LinkManager() {
  const dispatch  = useDispatch<AppDispatch>();
  const rawLinks  = useSelector((s: RootState) => s.resumeBuilder.fields.links);
  const isLocked  = useSelector((s: RootState) => !!s.resumeBuilder.lockedFields.links);

  // Local state — parse raw string once, sync back on change
  const [entries, setEntries] = React.useState<LinkEntry[]>(() => deserializeLinks(rawLinks));
  const [openDropdown, setOpenDropdown] = React.useState<string | null>(null);
  // Track which row is in "type a custom platform name" mode
  const [editingCustomId, setEditingCustomId] = React.useState<string | null>(null);

  // Keep local in sync if the Redux value changes externally (e.g. AI enhance)
  const prevRaw = React.useRef(rawLinks);
  React.useEffect(() => {
    if (rawLinks !== prevRaw.current) {
      prevRaw.current = rawLinks;
      setEntries(deserializeLinks(rawLinks));
    }
  }, [rawLinks]);

  // Commit to Redux whenever entries change
  const commit = useCallback((next: LinkEntry[]) => {
    const serialized = serializeLinks(next);
    prevRaw.current = serialized; // prevent echo-back
    dispatch(updateField({ field: "links", value: serialized }));
  }, [dispatch]);

  const addEntry = useCallback(() => {
    const newEntry: LinkEntry = { id: `link-${Date.now()}`, label: "Portfolio", url: "" };
    const next = [...entries, newEntry];
    setEntries(next);
    // Don't commit empty entries — they'll commit when URL is filled
  }, [entries]);

  const updateEntry = useCallback((id: string, field: keyof LinkEntry, value: string) => {
    const next = entries.map((e) => e.id === id ? { ...e, [field]: value } : e);
    setEntries(next);
    commit(next);
  }, [entries, commit]);

  const removeEntry = useCallback((id: string) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    commit(next);
  }, [entries, commit]);

  const moveUp = useCallback((id: string) => {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx <= 0) return;
    const next = [...entries];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setEntries(next);
    commit(next);
  }, [entries, commit]);

  const moveDown = useCallback((id: string) => {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1 || idx >= entries.length - 1) return;
    const next = [...entries];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setEntries(next);
    commit(next);
  }, [entries, commit]);

  return (
    <div className="col-span-2 space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        {isLocked && <Lock className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
        <Label className={cn("text-sm font-medium tracking-tight", isLocked ? "text-slate-400" : "text-slate-700")}>
          Links &amp; Profiles
        </Label>
        {isLocked && (
          <span className="text-[10px] text-muted-foreground/50 bg-muted/60 px-1.5 py-0.5 rounded-md font-medium ml-1">
            locked
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {entries.map((entry, idx) => (
          <div
            key={entry.id}
            className="flex items-center gap-1.5 group/row"
          >
            {/* Reorder */}
            <div className="flex flex-col gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
              <button
                type="button"
                disabled={isLocked || idx === 0}
                onClick={() => moveUp(entry.id)}
                className="flex items-center justify-center h-4 w-4 rounded text-slate-300 hover:text-slate-600 disabled:opacity-20 transition-colors"
                aria-label="Move up"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                disabled={isLocked || idx === entries.length - 1}
                onClick={() => moveDown(entry.id)}
                className="flex items-center justify-center h-4 w-4 rounded text-slate-300 hover:text-slate-600 disabled:opacity-20 transition-colors"
                aria-label="Move down"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            {/* Platform selector */}
            <div className="relative shrink-0">
              {editingCustomId === entry.id ? (
                // Custom label text input — shown when user picks "Custom"
                <Input
                  autoFocus
                  value={entry.label === "Custom" ? "" : entry.label}
                  onChange={(e) => {
                    const next = entries.map((en) =>
                      en.id === entry.id ? { ...en, label: e.target.value } : en
                    );
                    setEntries(next);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") {
                      e.preventDefault();
                      const finalLabel = entry.label.trim() || "Custom";
                      const next = entries.map((en) =>
                        en.id === entry.id ? { ...en, label: finalLabel } : en
                      );
                      setEntries(next);
                      commit(next);
                      setEditingCustomId(null);
                    }
                  }}
                  onBlur={() => {
                    const finalLabel = entry.label.trim() || "Custom";
                    const next = entries.map((en) =>
                      en.id === entry.id ? { ...en, label: finalLabel } : en
                    );
                    setEntries(next);
                    commit(next);
                    setEditingCustomId(null);
                  }}
                  placeholder="Platform name…"
                  className="h-9 w-[108px] rounded-lg border-slate-300 bg-white text-[12px] font-medium text-slate-700 focus-visible:ring-2 focus-visible:ring-slate-900/10 focus-visible:ring-offset-0 focus-visible:border-slate-400 placeholder:text-slate-300 placeholder:font-normal"
                />
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => setOpenDropdown(openDropdown === entry.id ? null : entry.id)}
                    className={cn(
                      "h-9 px-2.5 rounded-lg border text-[12px] font-medium text-slate-700 bg-white flex items-center gap-1 min-w-[108px] justify-between transition-colors",
                      "border-slate-200 hover:border-slate-300",
                      isLocked && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    <span className="truncate max-w-[80px]">{entry.label || "Platform"}</span>
                    <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" />
                  </button>
                  {openDropdown === entry.id && (
                    <div className="absolute z-50 top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.10)] py-1 min-w-[160px]">
                      {PLATFORM_CONFIGS.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => {
                            if (p.label === "Custom") {
                              // Enter custom name edit mode — clear label so placeholder shows
                              const next = entries.map((en) =>
                                en.id === entry.id ? { ...en, label: "Custom" } : en
                              );
                              setEntries(next);
                              setOpenDropdown(null);
                              setEditingCustomId(entry.id);
                            } else {
                              updateEntry(entry.id, "label", p.label);
                              setOpenDropdown(null);
                            }
                          }}
                          className={cn(
                            "w-full text-left px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 transition-colors",
                            entry.label === p.label && p.label !== "Custom" && "text-blue-600 font-medium",
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* URL input */}
            <Input
              value={entry.url}
              disabled={isLocked}
              onChange={(e) => updateEntry(entry.id, "url", e.target.value)}
              placeholder={PLATFORM_CONFIGS.find((p) => p.label === entry.label)?.placeholder ?? "https://…"}
              className={cn(
                "flex-1 h-9 rounded-lg border-slate-200 bg-white text-[13px]",
                "focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-900/8 focus-visible:ring-offset-0",
                "placeholder:text-slate-300",
                isLocked && "bg-slate-50/80 text-slate-400 cursor-not-allowed opacity-60",
              )}
            />

            {/* Preview link */}
            {entry.url.trim() && (
              <a
                href={entry.url.startsWith("http") ? entry.url : `https://${entry.url}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 flex items-center justify-center h-9 w-9 rounded-lg text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                tabIndex={-1}
                aria-label="Open link"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}

            {/* Remove */}
            <button
              type="button"
              disabled={isLocked}
              onClick={() => removeEntry(entry.id)}
              className="shrink-0 flex items-center justify-center h-9 w-9 rounded-lg text-slate-200 hover:text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover/row:opacity-100 disabled:opacity-0"
              aria-label="Remove link"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add link row */}
      {!isLocked && (
        <button
          type="button"
          onClick={addEntry}
          className="flex items-center gap-1.5 h-8 px-2 text-[12px] text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors mt-0.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add link
        </button>
      )}

      {/* Close dropdown on outside click */}
      {openDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpenDropdown(null)}
        />
      )}
    </div>
  );
});

// ─── FieldInput (module-level — MUST be outside any component) ───────────────
//
// Defining this inside SectionEditorFields causes React to create a NEW
// component reference on every parent render, forcing every input to unmount
// and remount — which is why focus was lost after every keystroke.
// Moving it to module scope means React always sees the SAME component type.
// Each instance subscribes only to its own field slice via useSelector so
// unrelated keystrokes never re-render sibling fields.  (rerender-no-inline-components)

