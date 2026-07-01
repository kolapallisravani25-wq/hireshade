import React, { useState, useRef, useEffect, useCallback, useDeferredValue } from "react";
import { useDispatch, useSelector } from "react-redux";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import { setPopulatedHtml, setZoom } from "@/store/resumeBuilderSlice";
import type { ResumeFields } from "@/store/resumeBuilderSlice";
import type { TemplateId } from "@/store/resumeBuilderSlice";
import type { ResumeData } from "@/lib/resumeTemplate";
import { TEMPLATES } from "../types";
import type { TemplateItem } from "../types";
import { populateTemplate, fieldsToResumeData } from "@/lib/resumeTemplate";
import {
  ZoomIn, ZoomOut, Maximize2, Minimize2, X, Check, ChevronLeft, ChevronDown,
  Layout, RotateCcw, LayoutTemplate, FileText, Loader2,
} from "lucide-react";

export function useA4PreviewScale(ref: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = React.useState(0.42);
  const rafRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const w = entry.contentRect.width;
        if (w > 0) {
          const next = w / 794;
          setScale((prev) => (Math.abs(prev - next) > 0.001 ? next : prev));
        }
      });
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [ref]);

  return scale;
}

// ─── TemplateMarketplace ───────────────────────────────────────────────────────

export function TemplateMarketplace({
  templates,
  currentTemplateId,
  fields,
  sections,
  onSelect,
  onClose,
}: {
  templates: TemplateItem[];
  currentTemplateId: string;
  fields: ResumeFields;
  sections: RootState["resumeBuilder"]["sections"];
  onSelect: (id: string, code: string) => void;
  onClose: () => void;
}) {
  const data = fieldsToResumeData(fields);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-bold tracking-tight">Choose Template</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Switch anytime — your content is preserved</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Template grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-6">
            {templates.map((tpl) => {
              // Determine if this template is the current one (match by id, name, or category)
              const tid = currentTemplateId?.toLowerCase();
              const isActive =
                tpl.id === currentTemplateId ||
                tpl.name.toLowerCase() === tid ||
                tpl.category.toLowerCase() === tid;

              // Render a tiny scaled iframe preview
              let previewHtml = "";
              try { previewHtml = populateTemplate(tpl.code, data, { sections }); } catch { /* ignore */ }

              return (
                <button
                  key={tpl.id}
                  onClick={() => { onSelect(tpl.id, tpl.code); onClose(); }}
                  className={cn(
                    "group relative flex flex-col rounded-2xl overflow-hidden border-2 transition-all text-left",
                    isActive
                      ? "border-[var(--color-brand)] shadow-[0_0_0_4px_var(--color-brand-muted)]"
                      : "border-border hover:border-[var(--color-brand)]/50 hover:shadow-md",
                  )}
                >
                  {/* Mini preview */}
                  <div className="relative bg-white overflow-hidden" style={{ height: 240 }}>
                    {previewHtml ? (
                      <iframe
                        srcDoc={previewHtml}
                        className="block border-none bg-white pointer-events-none"
                        style={{ width: 794, height: 1123, transform: "scale(0.302)", transformOrigin: "top left" }}
                        title={tpl.name}
                        sandbox=""
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted/30">
                        <FileText className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                    )}
                    {isActive && (
                      <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-[var(--color-brand)] flex items-center justify-center shadow-sm">
                        <Check className="h-3.5 w-3.5 text-white" />
                      </div>
                    )}
                  </div>

                  {/* Label */}
                  <div className={cn(
                    "px-4 py-3 border-t flex items-center justify-between",
                    isActive ? "bg-[var(--color-brand-muted)]/60 border-[var(--color-brand)]/20" : "bg-background border-border",
                  )}>
                    <span className={cn(
                      "text-sm font-semibold",
                      isActive ? "text-[var(--color-brand)]" : "text-foreground",
                    )}>
                      {tpl.name}
                    </span>
                    {isActive ? (
                      <span className="text-[10px] font-bold text-[var(--color-brand)] bg-[var(--color-brand-muted)] px-2 py-0.5 rounded-full">Active</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground group-hover:text-[var(--color-brand)] transition-colors">Apply →</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {templates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Loading templates…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── RightPanel ───────────────────────────────────────────────────────────────

export function RightPanel({
  templateCode,
  currentTemplateName,
  onOpenMarketplace,
}: {
  templateCode: string;
  currentTemplateName: string;
  onOpenMarketplace: () => void;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const zoom = useSelector((s: RootState) => s.resumeBuilder.zoom);
  const fields = useSelector((s: RootState) => s.resumeBuilder.fields);
  const sections = useSelector((s: RootState) => s.resumeBuilder.sections);

  // Defer the expensive template render so typing stays snappy.     (rerender-use-deferred-value)
  const deferredFields = useDeferredValue(fields);
  const deferredSections = useDeferredValue(sections);

  const [populatedHtml, setLocalHtml] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const populateTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewContainerRef = React.useRef<HTMLDivElement>(null);
  const baseScale = useA4PreviewScale(previewContainerRef);
  const finalScale = baseScale * zoom;
  const containerHeight = Math.round(1123 * finalScale);

  // Debounce template population by 400 ms
  useEffect(() => {
    if (!templateCode) return;
    clearTimeout(populateTimerRef.current);
    populateTimerRef.current = setTimeout(() => {
      try {
        const html = populateTemplate(templateCode, fieldsToResumeData(deferredFields), {
          sections: deferredSections,
        });
        setLocalHtml(html);
        // Mirror to redux so TopBar (PDF export) can read it without prop drilling.
        dispatch(setPopulatedHtml(html));
      } catch (err) {
        console.error("[RightPanel] populateTemplate error:", err);
      }
    }, 400);
    return () => clearTimeout(populateTimerRef.current);
  }, [deferredFields, deferredSections, templateCode, dispatch]);

  const iframeTransformStyle: React.CSSProperties =
    Math.abs(finalScale - 1) < 0.005
      ? { width: 794, height: 1123 }
      : { width: 794, height: 1123, transform: `scale(${finalScale})`, transformOrigin: "top left" };

  const ZOOM_STEP = 0.1;

  return (
    <aside className="w-[340px] shrink-0 border-l border-slate-200/70 bg-slate-50/40 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200/70 shrink-0 space-y-2.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Live Preview</h3>

        {/* Template picker button */}
        <button
          onClick={onOpenMarketplace}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 text-left group"
        >
          <LayoutTemplate className="h-3.5 w-3.5 text-muted-foreground group-hover:text-[var(--color-brand)] shrink-0 transition-colors" />
          <span className="flex-1 text-sm font-medium text-foreground truncate">{currentTemplateName || "Classic"}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-[var(--color-brand)] shrink-0 transition-colors" />
        </button>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-10 shrink-0">{Math.round(zoom * 100)}%</span>
          <div className="flex items-center gap-0.5 ml-auto">
            <button onClick={() => dispatch(setZoom(Math.max(0.3, zoom - ZOOM_STEP)))} className="p-1 rounded hover:bg-muted" title="Zoom out"><ZoomOut className="h-3.5 w-3.5 text-muted-foreground" /></button>
            <button onClick={() => dispatch(setZoom(1))} className="p-1 rounded hover:bg-muted" title="Reset zoom"><RotateCcw className="h-3 w-3 text-muted-foreground" /></button>
            <button onClick={() => dispatch(setZoom(Math.min(2, zoom + ZOOM_STEP)))} className="p-1 rounded hover:bg-muted" title="Zoom in"><ZoomIn className="h-3.5 w-3.5 text-muted-foreground" /></button>
            <span className="w-px h-4 bg-slate-200 mx-1" />
            <button
              onClick={() => setIsFullscreen(true)}
              disabled={!populatedHtml}
              className="p-1 rounded hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
              title="Open fullscreen preview"
            >
              <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>

      {/* Preview scroll area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3">
        <div
          ref={previewContainerRef}
          className="w-full bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.10)] border border-border/20 overflow-hidden"
          style={{ height: populatedHtml ? containerHeight : undefined, minHeight: populatedHtml ? undefined : 400 }}
        >
          {!populatedHtml ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-3 p-6 text-center">
              <div className="h-10 w-10 rounded-xl bg-[var(--color-brand)]/10 flex items-center justify-center">
                <FileText className="h-5 w-5 text-[var(--color-brand)]/40" />
              </div>
              <p className="text-xs text-muted-foreground">
                {templateCode ? "Generating preview…" : "Fill in your details to see a live preview."}
              </p>
            </div>
          ) : (
            <iframe
              srcDoc={populatedHtml}
              className="block border-none bg-white"
              style={iframeTransformStyle}
              title="Resume Preview"
              sandbox=""
            />
          )}
        </div>
      </div>

      {isFullscreen && populatedHtml && (
        <FullscreenPreviewDialog
          html={populatedHtml}
          templateName={currentTemplateName}
          onClose={() => setIsFullscreen(false)}
        />
      )}
    </aside>
  );
}

// ─── FullscreenPreviewDialog ──────────────────────────────────────────────────

/**
 * Premium fullscreen preview modal. Renders the populated resume HTML at high
 * fidelity with zoom (50–200%), fit-width, fit-page, and ESC-to-close. Reuses
 * the same `populatedHtml` string the RightPanel already builds so there's no
 * extra populate cost. The modal does NOT mutate any redux state — it is a
 * pure read-only viewer.
 */
export function FullscreenPreviewDialog({
  html,
  templateName,
  onClose,
}: {
  html: string;
  templateName: string;
  onClose: () => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [mode, setMode] = React.useState<"fit-width" | "fit-page" | "custom">("fit-page");
  const [customScale, setCustomScale] = React.useState(1);
  const [containerSize, setContainerSize] = React.useState({ w: 0, h: 0 });

  // ESC to close
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Track container size
  React.useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Compute effective scale based on mode
  const PAGE_W = 794;
  const PAGE_H = 1123;
  const PADDING = 64; // breathing room around the page
  const fitWidthScale = containerSize.w > 0 ? Math.max(0.1, (containerSize.w - PADDING) / PAGE_W) : 0.7;
  const fitPageScale = containerSize.w > 0 && containerSize.h > 0
    ? Math.min(
      (containerSize.w - PADDING) / PAGE_W,
      (containerSize.h - PADDING) / PAGE_H,
    )
    : 0.7;
  const effectiveScale =
    mode === "fit-width" ? fitWidthScale :
      mode === "fit-page" ? fitPageScale :
        customScale;

  const adjustZoom = (delta: number) => {
    const next = Math.max(0.5, Math.min(2, effectiveScale + delta));
    setCustomScale(next);
    setMode("custom");
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-md flex flex-col animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-5 h-14 border-b border-white/10 bg-slate-950/60">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-white/10 flex items-center justify-center">
            <FileText className="h-3.5 w-3.5 text-white/80" />
          </div>
          <div className="text-sm font-semibold text-white/90 truncate">
            {templateName || "Resume"} preview
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Fit-mode toggle */}
          <div className="flex items-center bg-white/10 rounded-lg p-0.5">
            <button
              onClick={() => setMode("fit-page")}
              className={cn(
                "h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors",
                mode === "fit-page" ? "bg-white text-slate-900" : "text-white/70 hover:text-white",
              )}
            >
              Fit page
            </button>
            <button
              onClick={() => setMode("fit-width")}
              className={cn(
                "h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors",
                mode === "fit-width" ? "bg-white text-slate-900" : "text-white/70 hover:text-white",
              )}
            >
              Fit width
            </button>
            <button
              onClick={() => { setCustomScale(1); setMode("custom"); }}
              className={cn(
                "h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors",
                mode === "custom" ? "bg-white text-slate-900" : "text-white/70 hover:text-white",
              )}
            >
              100%
            </button>
          </div>

          <div className="flex items-center gap-0.5 bg-white/10 rounded-lg p-0.5">
            <button
              onClick={() => adjustZoom(-0.1)}
              className="h-7 w-7 rounded-md flex items-center justify-center text-white/80 hover:bg-white/10"
              title="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] font-semibold text-white/90 tabular-nums w-11 text-center">
              {Math.round(effectiveScale * 100)}%
            </span>
            <button
              onClick={() => adjustZoom(0.1)}
              className="h-7 w-7 rounded-md flex items-center justify-center text-white/80 hover:bg-white/10"
              title="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 transition-colors ml-1"
            title="Close (Esc)"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Document stage — paper-like backdrop */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto px-8 py-8"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="mx-auto bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6),0_8px_24px_-8px_rgba(0,0,0,0.4)] rounded-md ring-1 ring-black/5"
          style={{
            width: PAGE_W * effectiveScale,
            height: PAGE_H * effectiveScale,
          }}
        >
          <iframe
            srcDoc={html}
            className="block border-none bg-white"
            style={{
              width: PAGE_W,
              height: PAGE_H,
              transform: `scale(${effectiveScale})`,
              transformOrigin: "top left",
            }}
            title="Resume Fullscreen Preview"
            sandbox=""
          />
        </div>
      </div>

      {/* Footer hint */}
      <div className="shrink-0 px-5 h-9 border-t border-white/10 bg-slate-950/60 flex items-center text-[11px] text-white/50">
        <span>Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/70 text-[10px] font-mono">Esc</kbd> to close · Click backdrop to dismiss</span>
      </div>
    </div>
  );
}

// ─── FullRewritePanel ─────────────────────────────────────────────────────────────────────────────
