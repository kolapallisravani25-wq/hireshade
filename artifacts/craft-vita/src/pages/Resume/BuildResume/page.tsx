 ;

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { BuildResumeDialog } from "@/components/Resume/BuildResumeDialog";
import UploadResumeDialog from "@/components/Resume/UploadResumeDialog";
import ListOfResumes from "@/components/Resume/ListOfResumes";
import { ENDPOINTS } from "@/lib/endpoints";
import { getAuthHeaders } from "@/lib/globalAuth";
import { populateTemplate, fieldsToResumeData } from "@/lib/resumeTemplate";
import type { ResumeFields } from "@/store/resumeBuilderSlice";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Search,
  FileText,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  X,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  Minimize2,
  Sparkles,
  ScanText,
  Mail,
  Wand2,
  Rocket,
  FileSearch,
  KeyRound,
  Copy,
  Download,
  Coins,
  ArrowRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ResumeEntry {
  id: string;
  title: string;
  template: string;
  status: string;
  createdAt: string;       // formatted display string
  lastModified: string;    // formatted display string
  _createdAtMs: number;    // epoch ms — used for sorting
  _updatedAtMs: number;    // epoch ms — used for sorting + relative time
}

type SortKey = "lastModified" | "createdAt" | "title";

interface PreviewState {
  id: string;
  title: string;
  template: string;
  html: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const DATE_FMT: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "short", day: "numeric",
  hour: "2-digit", minute: "2-digit",
};

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", DATE_FMT);
}

function relativeTime(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000)         return "just now";
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return fmtDate(new Date(ms).toISOString());
}

const TEMPLATE_DOTS: Record<string, string> = {
  minimal: "bg-slate-400",
  classic: "bg-blue-400",
  modern:  "bg-violet-400",
};

function templateDot(template: string): string {
  return TEMPLATE_DOTS[template.toLowerCase()] ?? "bg-slate-300";
}

const SORT_LABELS: Record<SortKey, string> = {
  lastModified: "Last Modified",
  createdAt:    "Date Created",
  title:        "Title (A–Z)",
};

const PAGE_SIZE = 12;
const THUMB_H   = 228; // visible px of the thumbnail strip

// ── ShadowHtml ────────────────────────────────────────────────────────────────
// Renders a full HTML document in an isolated iframe.
// Using srcDoc + sandbox="" ensures:
//   • Full document structure (html/head/body) is preserved, so template
//     styles like `body { display: flex }` (Modern template) apply correctly.
//   • Scripts are blocked (sandbox="" disables all permissions).
//   • Extension content-scripts (Grammarly etc.) cannot inject into a
//     sandboxed iframe.
function IframeHtml({
  html,
  style,
  onContentHeight,
}: {
  html: string;
  style?: React.CSSProperties;
  /** When provided, the iframe gets allow-same-origin so we can measure content height on load. */
  onContentHeight?: (h: number) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);

  const handleLoad = () => {
    if (!onContentHeight || !ref.current) return;
    try {
      const doc = ref.current.contentDocument;
      if (doc) {
        const h = doc.documentElement.scrollHeight;
        if (h > 0) onContentHeight(h);
      }
    } catch { /* sandboxed or cross-origin — ignore */ }
  };

  return (
    <iframe
      ref={ref}
      srcDoc={html}
      // allow-same-origin is added only when onContentHeight is supplied (preview dialog)
      // so we can read scrollHeight; the thumbnail keeps sandbox="" to block everything.
      sandbox={onContentHeight ? "allow-same-origin" : ""}
      scrolling="no"
      onLoad={onContentHeight ? handleLoad : undefined}
      style={{ border: "none", display: "block", ...style }}
    />
  );
}

// ── ResumeThumbnail ──────────────────────────────────────────────────────────────
// Lazily fetches and renders a scaled A4 preview when the card enters the
// viewport (IntersectionObserver).  Only the top THUMB_H pixels are shown so
// the name / header section is always visible and nothing scrolls inside.

function ResumeThumbnail({
  id,
  onPreview,
}: {
  id: string;
  onPreview: (id: string) => void;
}) {
  const { getToken } = useAuth();
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const fetchedRef  = useRef(false);

  const [html,    setHtml]    = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scale,   setScale]   = useState(1);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    // Track container width so scale stays accurate after layout changes
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setScale(w / A4_W);
    });
    ro.observe(el);

    // Fetch only when the card enters the viewport for the first time
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || fetchedRef.current) return;
        fetchedRef.current = true;
        io.disconnect();

        (async () => {
          setLoading(true);
          try {
            const token = await getToken();
            const res   = await fetch(ENDPOINTS.resumeBuilderGet(id), {
              headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (!res.ok) return;
            const r = json.resume ?? json;
            if (!r.templateCode || !r.fields) return;
            setHtml(populateTemplate(
              r.templateCode,
              fieldsToResumeData(r.fields as ResumeFields),
              { sections: r.sections ?? [] },
            ));
          } catch (err) {
            console.error("[ResumeThumbnail] fetch error:", err);
          } finally {
            setLoading(false);
          }
        })();
      },
      { threshold: 0.05 },
    );
    io.observe(el);

    return () => {
      ro.disconnect();
      io.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]); // getToken is stable; id never changes for a given card

  return (
    <div
      ref={wrapperRef}
      role="button"
      tabIndex={0}
      aria-label="Preview resume"
      onClick={() => onPreview(id)}
      onKeyDown={(e) => e.key === "Enter" && onPreview(id)}
      className="relative w-full group overflow-hidden cursor-pointer bg-slate-50 border-b border-border"
      style={{ height: THUMB_H }}
    >
      {html ? (
        /*
         * Two-layer scaling (same pattern as the full preview dialog):
         * - Outer div is the layout box measured by the card at THUMB_H height.
         * - Inner div holds the full A4 element, CSS-scaled from top-left,
         *   so the top THUMB_H visible-px of the resume is shown cleanly.
         * overflow-hidden on outer clips anything below THUMB_H.
         * pointer-events-none + scrolling="no" prevent any inner interaction.
         */
        <div style={{ width: "100%", height: THUMB_H, overflow: "hidden", position: "relative" }}>
          <div
            style={{
              width: A4_W,
              height: A4_H,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none",
            }}
          >
            <IframeHtml
              html={html}
              style={{ width: A4_W, height: A4_H, overflow: "hidden" }}
            />
          </div>
        </div>
      ) : (
        /* Skeleton shown while fetching */
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6">
          {loading ? (
            <Loader2 className="h-5 w-5 text-slate-300 animate-spin" />
          ) : (
            <div className="w-full flex flex-col gap-1.5 opacity-20">
              <div className="h-2.5 w-1/2 mx-auto rounded-sm bg-slate-400" />
              <div className="h-1 w-1/3 mx-auto rounded-sm bg-slate-300" />
              <div className="mt-2 h-1 w-full rounded-sm bg-slate-200" />
              <div className="h-1 w-5/6 rounded-sm bg-slate-200" />
              <div className="h-1 w-full rounded-sm bg-slate-200" />
              <div className="mt-1 h-1 w-full rounded-sm bg-slate-200" />
              <div className="h-1 w-4/5 rounded-sm bg-slate-200" />
              <div className="h-1 w-full rounded-sm bg-slate-200" />
            </div>
          )}
        </div>
      )}

      {/* Hover overlay — eye icon */}
      <div className="absolute inset-0 flex items-center justify-center bg-slate-900/0 group-hover:bg-slate-900/10 transition-colors">
        <div className="h-9 w-9 rounded-full bg-white/90 border border-border shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Eye className="h-4 w-4 text-slate-600" />
        </div>
      </div>
    </div>
  );
}
// ── ResumeCard ─────────────────────────────────────────────────────────────────

function ResumeCard({
  resume,
  isOpening,
  isLoadingPreview,
  isDuplicating,
  isDownloading,
  onOpen,
  onDelete,
  onPreview,
  onDuplicate,
  onDownload,
}: {
  resume: ResumeEntry;
  isOpening: boolean;
  isLoadingPreview: boolean;
  isDuplicating: boolean;
  isDownloading: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  onPreview: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDownload: (id: string) => void;
}) {
  const isCompleted = resume.status === "completed";

  return (
    <div
      className={cn(
        "group flex flex-col bg-white border border-border rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-md hover:border-slate-200",
        (isOpening || isLoadingPreview || isDuplicating || isDownloading) && "opacity-60 pointer-events-none",
      )}
    >
      {/* ── Preview thumbnail (dominant area) ── */}
      <div className="relative">
        <ResumeThumbnail id={resume.id} onPreview={onPreview} />
        {/* Status pill floated over thumbnail */}
        <div className="absolute top-2.5 right-2.5">
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 backdrop-blur-sm",
              isCompleted
                ? "bg-emerald-50/90 text-emerald-700 ring-emerald-200"
                : "bg-white/90 text-slate-500 ring-slate-200",
            )}
          >
            {resume.status.charAt(0).toUpperCase() + resume.status.slice(1)}
          </span>
        </div>
      </div>

      {/* ── Card body ── */}
      <div className="flex flex-col gap-3 p-4">

        {/* Template indicator row */}
        <div className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full shrink-0", templateDot(resume.template))} />
          <span className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">
            {resume.template}
          </span>
        </div>

        {/* Resume title */}
        <h3 className="text-[14px] font-semibold text-foreground leading-snug line-clamp-2 -mt-1">
          {resume.title}
        </h3>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-0.5">
          <div>
            <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide font-medium">Modified</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{relativeTime(resume._updatedAtMs)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide font-medium">Created</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{resume.createdAt}</p>
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 pt-2 border-t border-border/60">
          {/* Edit time label */}
          <span className="flex-1 text-[11px] text-muted-foreground truncate">
            Edited {relativeTime(resume._updatedAtMs)}
          </span>
          {/* Open */}
          <button
            onClick={() => onOpen(resume.id)}
            title="Open in Editor"
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-slate-100 transition-colors"
          >
            {isOpening
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Pencil className="h-3.5 w-3.5" />}
          </button>
          {/* Duplicate */}
          <button
            onClick={() => onDuplicate(resume.id)}
            title="Duplicate"
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-slate-100 transition-colors"
          >
            {isDuplicating
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Copy className="h-3.5 w-3.5" />}
          </button>
          {/* Download PDF */}
          <button
            onClick={() => onDownload(resume.id)}
            title="Download PDF"
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-slate-100 transition-colors"
          >
            {isDownloading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Download className="h-3.5 w-3.5" />}
          </button>
          {/* Delete */}
          <button
            onClick={() => onDelete(resume.id, resume.title)}
            title="Delete"
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Preview Dialog ───────────────────────────────────────────────────────────────

// A4 dimensions (px at 96dpi)
const A4_W = 794;
const A4_H = 1123;

/**
 * Fullscreen preview overlay — matches the editor's FullscreenPreviewDialog.
 * Dark backdrop, zoom controls (Fit page / Fit width / 100% / +/-), ESC to close.
 */
function ResumePreviewDialog({
  preview,
  onClose,
  onOpenEditor,
}: {
  preview: PreviewState | null;
  onClose: () => void;
  onOpenEditor: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"fit-width" | "fit-page" | "custom">("fit-page");
  const [customScale, setCustomScale] = useState(1);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  /** Actual document height in un-scaled px, measured when the iframe loads. */
  const [contentHeight, setContentHeight] = useState(A4_H);

  // ESC to close
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, onClose]);

  // Track container size for scale computation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [preview]);

  const PADDING = 64;
  const fitWidthScale = containerSize.w > 0 ? Math.max(0.1, (containerSize.w - PADDING) / A4_W) : 0.7;
  const fitPageScale =
    containerSize.w > 0 && containerSize.h > 0
      ? Math.min((containerSize.w - PADDING) / A4_W, (containerSize.h - PADDING) / contentHeight)
      : 0.7;
  const effectiveScale =
    mode === "fit-width" ? fitWidthScale :
    mode === "fit-page"  ? fitPageScale  :
    customScale;

  const adjustZoom = (delta: number) => {
    const next = Math.max(0.3, Math.min(2.5, effectiveScale + delta));
    setCustomScale(next);
    setMode("custom");
  };

  if (!preview) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-md flex flex-col animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* ── Toolbar ── */}
      <div className="shrink-0 flex items-center gap-3 px-5 h-14 border-b border-white/10 bg-slate-950/60">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-white/10 flex items-center justify-center">
            <FileText className="h-3.5 w-3.5 text-white/80" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white/90 truncate max-w-[220px]">
              {preview.title || "Resume Preview"}
            </div>
            {preview.template && (
              <div className="text-[10px] font-medium text-white/40 -mt-0.5">{preview.template}</div>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Fit-mode toggle */}
          <div className="flex items-center bg-white/10 rounded-lg p-0.5">
            {(["fit-page", "fit-width", "custom"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { if (m === "custom") { setCustomScale(1); } setMode(m); }}
                className={cn(
                  "h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors",
                  mode === m ? "bg-white text-slate-900" : "text-white/70 hover:text-white",
                )}
              >
                {m === "fit-page" ? "Fit page" : m === "fit-width" ? "Fit width" : "100%"}
              </button>
            ))}
          </div>

          {/* Zoom */}
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

          {/* Open in Editor */}
          <button
            onClick={() => { onClose(); onOpenEditor(preview.id); }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold bg-white/10 text-white/80 hover:bg-white/20 transition-colors border border-white/10"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Editor
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 transition-colors ml-1"
            title="Close (Esc)"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Document stage ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto px-8 py-8 flex flex-col items-center justify-start"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {preview.html ? (
          <div
            className="bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6),0_8px_24px_-8px_rgba(0,0,0,0.4)] rounded-sm ring-1 ring-black/5 mx-auto"
            style={{
              width:     Math.round(A4_W * effectiveScale),
              height:    Math.round(contentHeight * effectiveScale),
              flexShrink: 0,
              position: "relative",
            }}
          >
            <IframeHtml
              html={preview.html}
              onContentHeight={setContentHeight}
              style={{
                width:  A4_W,
                height: contentHeight,
                transform: `scale(${effectiveScale})`,
                transformOrigin: "top left",
                position: "absolute",
                top: 0,
                left: 0,
              }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 text-white/40 animate-spin" />
          </div>
        )}
      </div>

      {/* ── Footer hint ── */}
      <div className="shrink-0 px-5 h-9 border-t border-white/10 bg-slate-950/60 flex items-center text-[11px] text-white/50">
        Press <kbd className="mx-1.5 px-1.5 py-0.5 rounded bg-white/10 text-white/70 text-[10px] font-mono">Esc</kbd> to close · Click backdrop to dismiss
      </div>
    </div>
  );
}

// ── Skeleton card ──────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="flex flex-col bg-white border border-border rounded-2xl overflow-hidden">
      {/* Thumbnail placeholder */}
      <div className="bg-slate-100 animate-pulse" style={{ height: THUMB_H }} />
      {/* Body */}
      <div className="flex flex-col gap-3 p-4">
        <div className="h-2 w-16 rounded-full bg-slate-100 animate-pulse" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-3/4 rounded bg-slate-100 animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-0.5">
          <div className="space-y-1">
            <div className="h-2 w-12 rounded bg-slate-100 animate-pulse" />
            <div className="h-2.5 w-16 rounded bg-slate-100 animate-pulse" />
          </div>
          <div className="space-y-1">
            <div className="h-2 w-12 rounded bg-slate-100 animate-pulse" />
            <div className="h-2.5 w-20 rounded bg-slate-100 animate-pulse" />
          </div>
        </div>
        <div className="h-8 w-full rounded-xl bg-slate-100 animate-pulse mt-1" />
      </div>
    </div>
  );
}

// ── AI Capability Tools ────────────────────────────────────────────────────

interface AiTool {
  icon: React.ElementType;
  label: string;
  description: string;
  howItWorks: string;
  href: string;
  featureKey: string;
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  labelColor: string;
  descColor: string;
  accentClass: string;
}

const AI_TOOLS: AiTool[] = [
  {
    icon: Rocket,
    label: "JD Tailor",
    description: "Match resume to a job description",
    howItWorks:
      "Paste a job posting and HireShade rewrites your resume bullets, summary, and skills section to highlight the exact keywords and competencies recruiters are looking for. The first tailoring per resume costs credits; re-runs within 24 hours are free thanks to our generation cache.",
    href: "/resume/build",
    featureKey: "resume_tailor",
    bg: "bg-emerald-50",
    border: "border-emerald-100",
    iconBg: "bg-emerald-100/60 ring-emerald-200",
    iconColor: "text-emerald-600",
    labelColor: "text-emerald-700",
    descColor: "text-emerald-600/70",
    accentClass: "bg-emerald-600",
  },
  {
    icon: Wand2,
    label: "Rewrite Bullets",
    description: "Sharpen every bullet with AI",
    howItWorks:
      "Weak, passive bullet points are rewritten into strong, metric-driven achievement statements. The AI targets action verbs, adds impact quantifiers where possible, and tightens phrasing for ATS and human reviewers alike. Each full-resume rewrite consumes credits.",
    href: "/resume/build",
    featureKey: "resume_rewrite",
    bg: "bg-violet-50",
    border: "border-violet-100",
    iconBg: "bg-violet-100/60 ring-violet-200",
    iconColor: "text-violet-600",
    labelColor: "text-violet-700",
    descColor: "text-violet-600/70",
    accentClass: "bg-violet-600",
  },
  {
    icon: ScanText,
    label: "ATS Score",
    description: "See your match score + gaps",
    howItWorks:
      "HireShade simulates an Applicant Tracking System scan against a target job description, scoring keyword coverage, formatting compliance, and section completeness. You get a letter grade, a percentage score, and a prioritised list of gaps to close — completely free to run.",
    href: "/resume/ats-analysis",
    featureKey: "resume_ats_score",
    bg: "bg-amber-50",
    border: "border-amber-100",
    iconBg: "bg-amber-100/60 ring-amber-200",
    iconColor: "text-amber-600",
    labelColor: "text-amber-700",
    descColor: "text-amber-600/70",
    accentClass: "bg-amber-600",
  },
  {
    icon: Mail,
    label: "Cover Letter",
    description: "Draft a matching cover letter",
    howItWorks:
      "Generates a fully personalised cover letter in seconds by combining your resume content with the target role, company, and a tone of your choice (professional, enthusiastic, concise). Outputs a ready-to-edit draft you can copy or download — free to generate.",
    href: "/resume/cover-letter",
    featureKey: "resume_cover_letter",
    bg: "bg-sky-50",
    border: "border-sky-100",
    iconBg: "bg-sky-100/60 ring-sky-200",
    iconColor: "text-sky-600",
    labelColor: "text-sky-700",
    descColor: "text-sky-600/70",
    accentClass: "bg-sky-600",
  },
  {
    icon: KeyRound,
    label: "Keyword Inject",
    description: "Add missing keywords naturally",
    howItWorks:
      "Identifies high-value keywords from the job description that are absent from your resume and injects them into appropriate sections — without keyword stuffing. The result reads naturally to human reviewers while significantly boosting ATS match rates.",
    href: "/resume/build",
    featureKey: "resume_inject_keywords",
    bg: "bg-rose-50",
    border: "border-rose-100",
    iconBg: "bg-rose-100/60 ring-rose-200",
    iconColor: "text-rose-600",
    labelColor: "text-rose-700",
    descColor: "text-rose-600/70",
    accentClass: "bg-rose-600",
  },
] as const;

// ── AIToolInfoDialog ──────────────────────────────────────────────────────────
// Shows a detail sheet for an AI capability card — description, how it works,
// and a live credit cost badge fetched from GET /api/credits/feature-costs.

interface FeatureCostRow {
  featureKey: string;
  credits: string;
  label: string;
}

interface AIToolInfoDialogProps {
  tool: AiTool | null;
  onClose: () => void;
  costs: Record<string, string>; // featureKey → credits string
  costsLoading: boolean;
  navigate: (href: string) => void;
}

function AIToolInfoDialog({ tool, onClose, costs, costsLoading, navigate }: AIToolInfoDialogProps) {
  if (!tool) return null;
  const { icon: Icon, label, description, howItWorks, href, featureKey,
          bg, iconBg, iconColor, labelColor, accentClass } = tool;

  const rawCredits = costs[featureKey];
  const creditNum = rawCredits !== undefined ? parseFloat(rawCredits) : null;
  const isFree = creditNum !== null && creditNum === 0;
  const creditLabel = costsLoading
    ? null
    : isFree
    ? "Free"
    : creditNum !== null
    ? `${creditNum} credit${creditNum === 1 ? "" : "s"}`
    : null;

  return (
    <Dialog open={!!tool} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden rounded-2xl">
        {/* Header band */}
        <div className={`${bg} px-6 pt-6 pb-5 flex items-start gap-4`}>
          <div className={`h-11 w-11 rounded-xl flex items-center justify-center ring-1 shrink-0 ${iconBg} ${iconColor}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <DialogTitle className={`text-[15px] font-bold ${labelColor}`}>{label}</DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground mt-0.5">{description}</DialogDescription>
          </div>
          {/* Credit badge */}
          <div className="shrink-0">
            {costsLoading ? (
              <div className="h-6 w-16 rounded-full bg-black/8 animate-pulse" />
            ) : creditLabel ? (
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full
                ${isFree ? "bg-emerald-100 text-emerald-700" : "bg-black/8 text-foreground/80"}`}>
                {!isFree && <Coins className="h-3 w-3" />}
                {creditLabel}
              </span>
            ) : null}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/50 mb-1.5">How it works</p>
            <p className="text-[13px] text-foreground/80 leading-relaxed">{howItWorks}</p>
          </div>

          {/* Credit cost detail */}
          <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 flex items-center gap-3">
            <Coins className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1">
              <p className="text-[12px] font-medium text-foreground">
                {costsLoading ? (
                  <span className="inline-block h-4 w-28 rounded bg-muted animate-pulse" />
                ) : isFree ? (
                  "This tool is completely free to use."
                ) : creditLabel ? (
                  <>
                    Costs <span className="font-bold">{creditLabel}</span> per use from your balance.
                  </>
                ) : (
                  "Credit cost loaded from your plan."
                )}
              </p>
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={() => { onClose(); navigate(href); }}
            className={`w-full flex items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 ${accentClass}`}
          >
            Open {label}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


export default function BuildResume() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const navigate     = useNavigate();
  const { key: locationKey } = useLocation();

  const rawCacheRef = useRef<any[] | null>(null);

  // Resolved internal DB userId (set after useSyncUser fires)
  const [userId, setUserId]         = useState<string | null>(null);

  const [allEntries, setAllEntries] = useState<ResumeEntry[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [search, setSearch]         = useState("");
  const [sortBy, setSortBy]         = useState<SortKey>("lastModified");
  const [sortOrder, setSortOrder]   = useState<"asc" | "desc">("desc");
  const [page, setPage]             = useState(1);

  const [openingId, setOpeningId]           = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget]     = useState<{ id: string; title: string } | null>(null);
  const [isDeleting, setIsDeleting]         = useState(false);
  const [previewState, setPreviewState]     = useState<PreviewState | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId]   = useState<string | null>(null);
  const [downloadingId, setDownloadingId]   = useState<string | null>(null);

  // ── AI tool info dialog ────────────────────────────────────────────────────
  const [selectedTool, setSelectedTool] = useState<AiTool | null>(null);
  const [toolCosts, setToolCosts]        = useState<Record<string, string>>({});
  const [costsLoading, setCostsLoading]  = useState(false);
  const costsFetchedRef                  = useRef(false);

  // Fetch feature costs once on mount.
  useEffect(() => {
    if (costsFetchedRef.current) return;
    costsFetchedRef.current = true;
    setCostsLoading(true);
    getAuthHeaders()
      .then((authHeaders) => fetch(ENDPOINTS.creditsFeatureCosts(), { headers: authHeaders }))
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json?.data) return;
        const map: Record<string, string> = {};
        for (const row of json.data as FeatureCostRow[]) {
          map[row.featureKey] = row.credits;
        }
        setToolCosts(map);
      })
      .catch(console.error)
      .finally(() => setCostsLoading(false));
  }, []);

  // ── Resolve userId (fast path: localStorage, slow path: userSynced event) ──
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    // Fast path: useSyncUser already wrote the id
    const stored = localStorage.getItem("userId");
    if (stored) {
      setUserId(stored);
      return;
    }

    // Slow path: wait for useSyncUser to finish and broadcast
    function onUserSynced(e: Event) {
      const detail = (e as CustomEvent<{ userId: string }>).detail;
      if (detail?.userId) setUserId(detail.userId);
    }
    window.addEventListener("userSynced", onUserSynced);
    return () => window.removeEventListener("userSynced", onUserSynced);
  }, [isLoaded, isSignedIn]);

  // ── Load all resumes from API ──────────────────────────────────────────────
  const loadResumes = useCallback(async (uid: string) => {
    setIsLoading(true);
    try {
      if (!rawCacheRef.current) {
        const token = await getToken();
        const res = await fetch(ENDPOINTS.resumeBuilderList(uid), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { setAllEntries([]); return; }
        const json = await res.json();
        rawCacheRef.current = json.resumes ?? json.data ?? (Array.isArray(json) ? json : []);
      }

      const entries: ResumeEntry[] = rawCacheRef.current!.map((r) => ({
        id:           r.id,
        title:        r.title || "Untitled Resume",
        template:     r.templateName
          ? r.templateName
          : r.templateId
          ? r.templateId.charAt(0).toUpperCase() + r.templateId.slice(1)
          : "—",
        status:       r.status || "draft",
        createdAt:    fmtDate(r.createdAt),
        lastModified: fmtDate(r.updatedAt),
        _createdAtMs: r.createdAt ? new Date(r.createdAt).getTime() : 0,
        _updatedAtMs: r.updatedAt ? new Date(r.updatedAt).getTime() : 0,
      }));

      setAllEntries(entries);
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  // Re-fetch whenever userId resolves or the route key changes (navigation)
  useEffect(() => {
    if (!userId) return;
    rawCacheRef.current = null;
    loadResumes(userId);
  }, [userId, locationKey, loadResumes]);

  // Reset to page 1 when search/sort changes
  useEffect(() => { setPage(1); }, [search, sortBy, sortOrder]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const filtered = allEntries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.title.toLowerCase().includes(q) ||
      e.template.toLowerCase().includes(q) ||
      e.status.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortOrder === "asc" ? 1 : -1;
    switch (sortBy) {
      case "createdAt": return dir * (a._createdAtMs - b._createdAtMs);
      case "title":     return dir * a.title.localeCompare(b.title);
      default:          return dir * (a._updatedAtMs - b._updatedAtMs);
    }
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated  = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Open existing resume in editor ─────────────────────────────────────────
  const handleOpen = useCallback(
    async (id: string) => {
      if (openingId) return;
      setOpeningId(id);
      try {
        const token = await getToken();
        const res = await fetch(ENDPOINTS.resumeBuilderGet(id), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load resume");
        const r = json.resume ?? json;
        navigate("/resume/editor", {
          state: {
            config: {
              sourceType:     "builder",
              resumeId:       r.id,
              resumeTitle:    r.title,
              fields:         r.fields,
              sections:       r.sections ?? [],
              templateId:     r.templateId,
              templateCode:   r.templateCode ?? null,
              jobDescription: r.jobDescription ?? "",
              jobTitle:       r.jobTitle ?? "",
              company:        r.company ?? "",
            },
          },
        });
      } catch (err) {
        console.error("[BuildResume] open error:", err);
      } finally {
        setOpeningId(null);
      }
    },
    [getToken, navigate, openingId],
  );

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const token = await getToken();
      await fetch(ENDPOINTS.resumeBuilderDelete(deleteTarget.id), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      rawCacheRef.current = null;
      setDeleteTarget(null);
      if (userId) await loadResumes(userId);
    } catch (err) {
      console.error("[BuildResume] delete error:", err);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, getToken, loadResumes]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortOrder(key === "title" ? "asc" : "desc");
    }
  };

  // ── Duplicate resume ────────────────────────────────────────────────────
  const handleDuplicate = useCallback(
    async (id: string) => {
      if (duplicatingId) return;
      setDuplicatingId(id);
      try {
        const token = await getToken();
        const res = await fetch(ENDPOINTS.resumeBuilderGet(id), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load resume");
        const r = json.resume ?? json;
        const saveRes = await fetch(ENDPOINTS.resumeBuilderSave(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            userId,
            title: `${r.title} (Copy)`,
            templateId: r.templateId,
            templateCode: r.templateCode ?? null,
            fields: r.fields,
            sections: r.sections ?? [],
            jobDescription: r.jobDescription ?? "",
            jobTitle: r.jobTitle ?? "",
            company: r.company ?? "",
          }),
        });
        if (!saveRes.ok) throw new Error("Failed to duplicate");
        rawCacheRef.current = null;
        if (userId) await loadResumes(userId);
      } catch (err) {
        console.error("[BuildResume] duplicate error:", err);
      } finally {
        setDuplicatingId(null);
      }
    },
    [duplicatingId, getToken, loadResumes, userId],
  );

  // ── Download PDF ─────────────────────────────────────────────────────────
  const handleDownload = useCallback(
    async (id: string) => {
      if (downloadingId) return;
      setDownloadingId(id);
      try {
        const token = await getToken();

        // 1. Fetch resume data (templateCode + fields) — same pattern as handlePreview
        const dataRes = await fetch(ENDPOINTS.resumeBuilderGet(id), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const dataJson = await dataRes.json();
        if (!dataRes.ok) throw new Error(dataJson.error || "Failed to load resume");
        const r = dataJson.resume ?? dataJson;
        if (!r.templateCode || !r.fields) {
          throw new Error("Resume template or fields not found");
        }

        // 2. Populate the HTML template client-side (same function used by preview)
        const populatedHtml = populateTemplate(
          r.templateCode,
          fieldsToResumeData(r.fields as ResumeFields),
          { sections: r.sections ?? [] },
        );

        // 3. Send the fully rendered HTML to the PDF export endpoint
        const entry = allEntries.find((e) => e.id === id);
        const userName = r.fields?.name || "Resume";
        const targetRole = r.fields?.role || r.jobTitle || "";
        const baseName = targetRole ? `${userName} - ${targetRole}` : (entry?.title ?? r.title ?? userName);
        const filename = `${baseName.replace(/[^a-z0-9_\-\s]+/gi, "").trim().replace(/\s+/g, "_")}.pdf`;
        const res = await fetch(ENDPOINTS.resumeBuilderExportPdf(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ resumeId: id, populatedHtml, suggestedFilename: filename.replace(/\.pdf$/i, "") }),
        });
        if (!res.ok) throw new Error("Export failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("[BuildResume] download error:", err);
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadingId, getToken, allEntries],
  );

  // ── Preview resume (client-side rendering) ────────────────────────────────
  const handlePreview = useCallback(
    async (id: string) => {
      if (previewLoadingId) return;
      setPreviewLoadingId(id);
      try {
        const token = await getToken();
        const res = await fetch(ENDPOINTS.resumeBuilderGet(id), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load resume");
        const r = json.resume ?? json;
        if (!r.templateCode || !r.fields) throw new Error("No template or fields returned");
        const html = populateTemplate(
          r.templateCode,
          fieldsToResumeData(r.fields as ResumeFields),
          { sections: r.sections ?? [] },
        );
        const template = r.templateName ?? (r.templateId
          ? r.templateId.charAt(0).toUpperCase() + r.templateId.slice(1)
          : "Standard");
        setPreviewState({ id, title: r.title || "Untitled Resume", template, html });
      } catch (err) {
        console.error("[BuildResume] preview error:", err);
      } finally {
        setPreviewLoadingId(null);
      }
    },
    [getToken, previewLoadingId],
  );

  // ── Auth guards ────────────────────────────────────────────────────────────
  // Show skeleton while Clerk is initialising OR while userId hasn't resolved yet
  if (!isLoaded || (isSignedIn && !userId)) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-9 w-56 rounded-lg bg-slate-100 animate-pulse" />
          <div className="h-9 w-36 rounded-lg bg-slate-100 animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-9 w-56 rounded-lg bg-slate-100 animate-pulse" />
          <div className="h-9 w-36 rounded-lg bg-slate-100 animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  // ── All-empty state — handled inline in main render ───────────────────────

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-6">

        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <h1 className="text-[22px] font-bold text-foreground tracking-tight">Resume Studio</h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand/10 text-brand text-[10px] font-semibold ring-1 ring-brand/20">
                <Sparkles className="h-2.5 w-2.5" />
                AI
              </span>
            </div>
            <p className="text-[13px] text-muted-foreground max-w-[480px] leading-relaxed">
              Build, tailor, and manage your resumes. Every resume here can be enhanced with AI in seconds.
            </p>
          </div>
          <BuildResumeDialog />
        </div>

        {/* ── Hero banner ── */}
        <div className="relative rounded-2xl border border-border bg-gradient-to-br from-slate-50 via-white to-slate-50 overflow-hidden px-7 py-6">
          {/* Subtle grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.035] pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(to right,#64748b 1px,transparent 1px),linear-gradient(to bottom,#64748b 1px,transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          <div className="relative flex items-center justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60 mb-2.5">
                AI-POWERED RESUME STUDIO
              </p>
              <h2 className="text-[20px] font-bold text-foreground leading-tight mb-2">
                Build and tailor your resume{" "}
                <span className="text-brand">with AI assistance</span>
              </h2>
              <p className="text-[13px] text-muted-foreground max-w-[420px] leading-relaxed">
                Start from scratch or enhance an existing resume. AI rewrites bullets,
                scores ATS match, and drafts cover letters for every role you apply to.
              </p>
            </div>
            <div className="flex items-center gap-5 shrink-0">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide mb-0.5">Resumes</p>
                <p className="text-[22px] font-bold text-foreground tabular-nums">{allEntries.length}</p>
              </div>
              <div className="w-px h-10 bg-border" />
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide mb-0.5">Completed</p>
                <p className="text-[22px] font-bold text-brand tabular-nums">
                  {allEntries.filter((e) => e.status === "completed").length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── AI Capabilities ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              AI CAPABILITIES
            </p>
            <p className="text-[11px] text-muted-foreground/50">Click any tool to get started</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {AI_TOOLS.map((tool) => {
              const { icon: Icon, label, description, bg, border, iconBg, iconColor, labelColor, descColor } = tool;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSelectedTool(tool)}
                  className={cn(
                    "group flex flex-col gap-2.5 p-3.5 rounded-xl border text-left transition-all duration-150 hover:shadow-sm hover:brightness-[0.97]",
                    bg, border,
                  )}
                >
                  <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center ring-1 shrink-0 transition-transform group-hover:scale-105", iconBg, iconColor)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className={cn("text-[12px] font-semibold leading-tight", labelColor)}>{label}</p>
                    <p className={cn("text-[11px] mt-0.5 leading-snug", descColor)}>{description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── AI Tool Info Dialog ── */}
        <AIToolInfoDialog
          tool={selectedTool}
          onClose={() => setSelectedTool(null)}
          costs={toolCosts}
          costsLoading={costsLoading}
          navigate={(href) => navigate(href)}
        />

        {/* ── Divider ── */}
        <div className="flex items-center gap-3">
          <div className="flex-1 border-t border-border/60" />
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Your Resumes</p>
          <div className="flex-1 border-t border-border/60" />
        </div>

        {/* ── Toolbar ── */}
        <div className="flex items-center gap-2.5 flex-wrap -mt-1">

          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search resumes…"
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-border bg-background text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring transition-shadow"
            />
          </div>

          {/* Sort dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 h-9 px-3.5 rounded-xl border border-border bg-background text-[12px] font-medium text-foreground hover:bg-slate-50 transition-colors whitespace-nowrap">
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                {SORT_LABELS[sortBy]}
                <span className="text-[11px] text-muted-foreground font-normal">{sortOrder === "asc" ? "↑" : "↓"}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Sort by
              </DropdownMenuLabel>
              {(["lastModified", "createdAt", "title"] as const).map((key) => (
                <DropdownMenuItem
                  key={key}
                  className={cn(sortBy === key && "bg-slate-50 font-medium")}
                  onClick={() => toggleSort(key)}
                >
                  {SORT_LABELS[key]}
                  {sortBy === key && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {sortOrder === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Upload an existing resume */}
          {userId && (
            <UploadResumeDialog userId={userId} triggerClassName="h-9 rounded-xl" />
          )}

          {/* Cover Letter shortcut */}
          <Link
            to="/resume/cover-letter"
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-xl border border-border bg-background text-[12px] font-medium text-foreground hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            Cover Letter
          </Link>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Resume count */}
          <span className="text-[12px] text-muted-foreground whitespace-nowrap tabular-nums">
            {sorted.length} {sorted.length === 1 ? "resume" : "resumes"}
          </span>
        </div>

        {/* ── Search empty state ── */}
        {paginated.length === 0 && search ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-10 w-10 rounded-xl bg-slate-100 border border-border flex items-center justify-center mb-3">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-[13px] font-medium text-foreground">No results for "{search}"</p>
            <p className="text-[12px] text-muted-foreground mt-1">Try a different search term.</p>
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-12 w-12 rounded-2xl bg-slate-100 border border-border flex items-center justify-center mb-4">
              <FileText className="h-5 w-5 text-slate-400" />
            </div>
            <p className="text-[14px] font-semibold text-foreground">No resumes yet</p>
            <p className="text-[12px] text-muted-foreground mt-1.5 max-w-[240px] leading-relaxed">
              Click <strong>Build Resume</strong> above to get started.
            </p>
          </div>
        ) : (
          /* ── Card grid ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginated.map((resume) => (
              <ResumeCard
                key={resume.id}
                resume={resume}
                isOpening={openingId === resume.id}
                isLoadingPreview={previewLoadingId === resume.id}
                isDuplicating={duplicatingId === resume.id}
                isDownloading={downloadingId === resume.id}
                onOpen={handleOpen}
                onDelete={(id, title) => setDeleteTarget({ id, title })}
                onPreview={handlePreview}
                onDuplicate={handleDuplicate}
                onDownload={handleDownload}
              />
            ))}
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-[12px] text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                const pg    = start + i;
                if (pg > totalPages) return null;
                return (
                  <button
                    key={pg}
                    onClick={() => setPage(pg)}
                    className={cn(
                      "h-8 w-8 flex items-center justify-center rounded-lg text-[12px] border transition-colors",
                      pg === page
                        ? "bg-slate-900 text-white border-slate-900 font-semibold"
                        : "border-border text-foreground hover:bg-slate-50",
                    )}
                  >
                    {pg}
                  </button>
                );
              })}

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Uploaded resumes ── */}
        {userId && (
          <>
            <div className="flex items-center gap-3 pt-2">
              <div className="flex-1 border-t border-border/60" />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Uploaded Resumes</p>
              <div className="flex-1 border-t border-border/60" />
            </div>
            <ListOfResumes userId={userId} onSelectResume={() => {}} />
          </>
        )}
      </div>

      {/* ── Resume Preview Dialog ── */}
      <ResumePreviewDialog
        preview={previewState}
        onClose={() => setPreviewState(null)}
        onOpenEditor={(id) => { setPreviewState(null); handleOpen(id); }}
      />

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete resume?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.title}</strong> will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

