import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ProjectReportView, ProjectResponse } from "@/components/AI projects/ProjectReportView";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Share2, Download, RefreshCw, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@clerk/clerk-react";
import { toast } from "sonner";
import { ENDPOINTS } from "@/lib/endpoints";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { OutOfCreditsDialog } from "@/components/Billing/OutOfCreditsDialog";
import { VersionHistorySheet } from "@/components/AI projects/VersionHistorySheet";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  setPdfBusy,
  setPdfResult,
  clearPdfForRecord,
  setRegenerating,
  setActiveProjectRecord,
  setRegenJob,
  tickRegenJob,
  finishRegenJob,
  errorRegenJob,
} from "@/store/aiProjectsSlice";
import { getPdfCache, setPdfCache, clearPdfCache } from "@/lib/pdfCache";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectRecord {
  id: string;
  position: string;
  industry?: string;
  experienceLevel?: string;
  jobDescription: string;
  resumeId: string | null;
  projects: ProjectResponse[];
  userId: string;
  createdAt: string;
  updatedAt: string;
}

// ─── PDF generation ───────────────────────────────────────────────────────────

// html2canvas-pro is used instead of html2canvas — it natively supports
// modern CSS color functions (oklch, oklab, lch, lab, color()) that
// Tailwind v4 emits for all its CSS custom properties.

// ─── Smart page-break helpers ─────────────────────────────────────────────────
//
// Strategy (js-index-maps, rerender-dependencies):
//   1. Collect the canvas-pixel y-positions of every semantic block inside
//      reportEl (sections, headings, cards) as candidate page-break points.
//   2. For each A4 page, pick the latest candidate that fits; fall back to a
//      hard cut only when a single element is taller than a full page.
//   3. Render each resulting slice as one PDF page so content never cuts mid-word.

const PAGE_W_MM    = 210;
const PAGE_H_MM    = 297;
const MARGIN_MM    = 12;
const CONTENT_W_MM = PAGE_W_MM - MARGIN_MM * 2;
const CONTENT_H_MM = PAGE_H_MM - MARGIN_MM * 2;

// Selectors for elements whose top edge is a safe page-break candidate.
// Matches every SectionBlock (`id="section-*"` + `scroll-mt-20`) and visible cards.
const BREAK_SELECTOR = [
  "[id^='section-']",
  "section",
  "h1", "h2", "h3",
].join(",");

function collectBreakPoints(reportEl: HTMLElement, scale: number): number[] {
  const reportTop = reportEl.getBoundingClientRect().top;
  const pts = new Set<number>([0]);
  reportEl.querySelectorAll<HTMLElement>(BREAK_SELECTOR).forEach((el) => {
    const relTop = (el.getBoundingClientRect().top - reportTop) * scale;
    if (relTop > 4) pts.add(Math.floor(relTop));   // skip sub-4px noise
  });
  return [...pts].sort((a, b) => a - b);
}

function buildPageSlices(
  canvasHeight: number,
  pageHeightPx: number,
  breakPoints: number[],
): Array<{ start: number; end: number }> {
  const slices: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  while (cursor < canvasHeight) {
    const ideal = cursor + pageHeightPx;

    if (ideal >= canvasHeight) {
      slices.push({ start: cursor, end: canvasHeight });
      break;
    }

    // Latest break point that fits within this page (js-early-exit)
    let cut = ideal;          // fallback: hard cut
    for (let i = breakPoints.length - 1; i >= 0; i--) {
      const bp = breakPoints[i];
      if (bp <= cursor) break; // no point further back than current cursor
      if (bp < ideal) { cut = bp; break; }
    }

    // Always advance — if no break found before ideal, hard-cut at ideal
    if (cut <= cursor) cut = ideal;

    slices.push({ start: cursor, end: cut });
    cursor = cut;
  }

  return slices;
}

// ─── Download / Share helpers ─────────────────────────────────────────────────

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename; a.click();
}

async function sharePdf(dataUrl: string, filename: string) {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], filename, { type: "application/pdf" });
  if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
  } else {
    downloadDataUrl(dataUrl, filename);
  }
}

// ─── Streaming helper ─────────────────────────────────────────────────────────

const STREAM_DELIM = "|||PROJECT_END|||";
async function streamProjects(res: Response, onProject: (p: ProjectResponse) => void) {
  if (!res.body) throw new Error("ReadableStream not supported");
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split(STREAM_DELIM); buf = parts.pop() ?? "";
    for (const part of parts) {
      const t = part.trim().replace(/^```json\n?/i, "").replace(/\n?```$/i, "").trim();
      if (!t) continue;
      try { onProject(JSON.parse(t) as ProjectResponse); } catch { /* skip */ }
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectRecommendations() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { balance, refresh: refreshBalance } = useCreditsBalance();
  const dispatch = useAppDispatch();

  // ── Local state (page-mount lifecycle) ───────────────────────────────────
  const [data, setData] = useState<ProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOutOfCredits, setShowOutOfCredits] = useState(false);

  const reportRef = useRef<HTMLDivElement>(null);

  // ── Redux state (survives navigation) ────────────────────────────────────
  const pdfState = useAppSelector((s) =>
    projectId ? (s.aiProjects.pdfByRecord[projectId] ?? { dataUrl: null, ready: false, busyFor: null }) : { dataUrl: null, ready: false, busyFor: null },
  );
  const regenerating = useAppSelector((s) =>
    projectId ? !!s.aiProjects.regeneratingIds[projectId] : false,
  );

  const pdfBusyFor = pdfState.busyFor;
  const pdfReady   = pdfState.ready;
  const pdfDataUrl = pdfState.dataUrl;

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true); setError(null);
    try {
      const token = await getToken();
      const res = await fetch(ENDPOINTS.projectsGet(projectId), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error || "Failed to fetch project");
      }
      const json = await res.json();
      let pd = json.projects;
      if (typeof pd === "string") { try { pd = JSON.parse(pd); } catch { pd = []; } }
      if (pd && !Array.isArray(pd) && Array.isArray((pd as { projects?: unknown[] }).projects))
        pd = (pd as { projects: unknown[] }).projects;
      if (Array.isArray(pd))
        pd = pd.map((p: unknown) => { if (typeof p === "string") { try { return JSON.parse(p); } catch { return p; } } return p; });
      json.projects = Array.isArray(pd) ? pd : [];
      const record = json as ProjectRecord;
      setData(record);
      dispatch(setActiveProjectRecord(record));
    } catch (err: unknown) {
      setError((err as Error).message || "Something went wrong");
    } finally { setLoading(false); }
  }, [projectId, dispatch, getToken]);

  useEffect(() => { fetchProject(); }, [fetchProject]);

  // Restore cached PDF into Redux on load (if IDB has it but Redux doesn't)
  useEffect(() => {
    if (!projectId || pdfReady) return;
    getPdfCache(projectId).then((cached) => {
      if (cached) dispatch(setPdfResult({ id: projectId, dataUrl: cached }));
    });
  }, [projectId, pdfReady, dispatch]);

  // ── Regenerate ────────────────────────────────────────────────────────────

  const handleRegenerate = useCallback(async () => {
    if (!data || !projectId) return;
    const resumeId = data.resumeId;
    if (!resumeId) {
      toast.error("This project has no linked resume. Select a resume and create a new generation.");
      return;
    }
    if (parseFloat(balance?.totalAvailable ?? "0") <= 0) { setShowOutOfCredits(true); return; }

    // 1. Set Redux regen-job so the table page can show the progress row
    dispatch(setRegenJob({
      recordId: projectId,
      position: data.position,
      industry: data.industry ?? "",
    }));
    dispatch(setRegenerating({ id: projectId, value: true }));

    // 2. Navigate to the table immediately — user sees the in-progress row there
    navigate("/ai-projects");

    // 3. Continue the fetch/stream/PATCH in the background (fire-and-forget)
    const run = async () => {
      const tid = "cv-regen";
      toast.loading("Regenerating projects…", { id: tid });
      try {
        const token = await getToken();
        const storedUserId = localStorage.getItem("userId") ?? undefined;
        const body: Record<string, string> = { position: data.position, jobDescription: data.jobDescription ?? "" };
        if (storedUserId)         body.userId          = storedUserId;
        body.resumeId = resumeId;
        if (data.industry)        body.industry        = data.industry;
        if (data.experienceLevel) body.experienceLevel = data.experienceLevel;

        const res = await fetch(ENDPOINTS.projectsGenerate(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          const msg = (e as { error?: string }).error ?? "Regeneration failed";
          toast.error(msg, { id: tid });
          dispatch(errorRegenJob(msg));
          return;
        }

        const newProjects: ProjectResponse[] = [];
        await streamProjects(res, (p) => {
          newProjects.push(p);
          dispatch(tickRegenJob());   // advance count 0→1→2→3 for progress dots
        });

        if (!newProjects.length) {
          const msg = "No projects returned — try again.";
          toast.error(msg, { id: tid });
          dispatch(errorRegenJob(msg));
          return;
        }

        const patchToken = await getToken();
        await fetch(ENDPOINTS.projectsReplaceProjects(projectId), {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${patchToken}` },
          body: JSON.stringify({ projects: newProjects }),
        }).catch(() => { /* best-effort */ });

        await clearPdfCache(projectId);
        dispatch(clearPdfForRecord(projectId));
        dispatch(finishRegenJob());
        refreshBalance();
        toast.success("Projects regenerated!", { id: tid });
      } catch (err: unknown) {
        const msg = (err as Error).message || "Unexpected error";
        toast.error(msg, { id: "cv-regen" });
        dispatch(errorRegenJob(msg));
      } finally {
        dispatch(setRegenerating({ id: projectId, value: false }));
      }
    };

    run();
  }, [data, projectId, balance, getToken, refreshBalance, dispatch, navigate]);

  // ── PDF ───────────────────────────────────────────────────────────────────

  const pdfFilename = useCallback(() =>
    data?.position ? `${data.position.replace(/\s+/g, "-")}-AI-Projects.pdf` : "AI-Projects.pdf"
  , [data]);

  // Returns a cached or freshly-generated PDF blob URL.
  // Caller must dispatch setPdfBusy BEFORE calling this so the right button shows a spinner.
  const getOrGenPdf = useCallback(async (): Promise<string | null> => {
    // 1. In-memory Redux hit — instant
    if (pdfDataUrl) return pdfDataUrl;

    // 2. IndexedDB hit — fast
    if (projectId) {
      const cached = await getPdfCache(projectId);
      if (cached) {
        dispatch(setPdfResult({ id: projectId, dataUrl: cached }));
        return cached;
      }
    }

    // 3. Call backend Playwright PDF endpoint
    if (!projectId) return null;
    const tid = "cv-pdf";
    toast.loading("Generating PDF — this may take a moment…", { id: tid });
    try {
      const token = await getToken();
      const res = await fetch(ENDPOINTS.projectsExportPdf(projectId), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "PDF generation failed");
      }
      const blob = await res.blob();
      // Convert to data URL so it survives IndexedDB storage and the share flow
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      await setPdfCache(projectId, url);
      dispatch(setPdfResult({ id: projectId, dataUrl: url }));
      toast.success("PDF ready! You can now download or share it.", { id: tid, duration: 4000 });
      return url;
    } catch (err: unknown) {
      console.error("PDF error", err);
      toast.error("PDF generation failed — try again.", { id: tid });
      return null;
    }
  }, [pdfDataUrl, projectId, getToken, dispatch]);

  const handleExportPDF = useCallback(async () => {
    if (!projectId || pdfBusyFor) return;
    dispatch(setPdfBusy({ id: projectId, busyFor: "export" }));
    try {
      const url = await getOrGenPdf();
      if (url) downloadDataUrl(url, pdfFilename());
    } finally {
      dispatch(setPdfBusy({ id: projectId, busyFor: null }));
    }
  }, [getOrGenPdf, pdfFilename, pdfBusyFor, projectId, dispatch]);

  const handleSharePDF = useCallback(async () => {
    if (!projectId || pdfBusyFor) return;
    dispatch(setPdfBusy({ id: projectId, busyFor: "share" }));
    try {
      const url = await getOrGenPdf();
      if (!url) return;
      try { await sharePdf(url, pdfFilename()); }
      catch (err: unknown) { if ((err as Error).name !== "AbortError") toast.error("Could not share PDF"); }
    } finally {
      dispatch(setPdfBusy({ id: projectId, busyFor: null }));
    }
  }, [getOrGenPdf, pdfFilename, pdfBusyFor, projectId, dispatch]);

  // ── Loading / Error ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="space-y-3">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <p className="text-sm font-medium text-destructive">{error || "Project not found"}</p>
        <Link to="/ai-projects">
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Projects
          </Button>
        </Link>
      </div>
    );
  }

  const pdfGenerating = pdfBusyFor !== null;

  return (
    <div className="min-h-0 space-y-4 pb-6">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 sticky top-0 z-20 bg-muted/90 backdrop-blur-sm py-2 -mx-4 px-4 md:-mx-8 md:px-8 border-b border-border/40">
        <Link to="/ai-projects">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2 h-8">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden xs:inline">All Projects</span>
          </Button>
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2">

          {/* Version history */}
          {projectId && (
            <VersionHistorySheet
              projectId={projectId}
              onRollbackSuccess={() => {
                fetchProject();
                if (projectId) clearPdfCache(projectId).then(() => dispatch(clearPdfForRecord(projectId)));
              }}
            />
          )}

          {/* Regenerate — disabled while regenerating or a PDF is being generated */}
          <Button
            variant="outline" size="sm" className="gap-1.5 h-8"
            onClick={handleRegenerate}
            disabled={regenerating || pdfGenerating}
          >
            {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{regenerating ? "Regenerating…" : "Regenerate"}</span>
          </Button>

          {/* Share PDF — spinner only on this button, only when share triggered the generation */}
          <Button
            variant="outline" size="sm" className="gap-1.5 h-8"
            onClick={handleSharePDF}
            disabled={regenerating || pdfBusyFor === "share"}
          >
            {pdfBusyFor === "share"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Share2 className="h-3.5 w-3.5" />
            }
            <span className="hidden sm:inline">
              {pdfBusyFor === "share" ? "Preparing…" : "Share PDF"}
            </span>
          </Button>

          {/* Export PDF — spinner only on this button, only when export triggered the generation */}
          <Button
            size="sm" className="gap-1.5 h-8 bg-[#458fff] hover:bg-[#1a73ff] text-white border-0"
            onClick={handleExportPDF}
            disabled={regenerating || pdfBusyFor === "export"}
          >
            {pdfBusyFor === "export"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : pdfReady ? <FileText className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />
            }
            <span className="hidden sm:inline">
              {pdfBusyFor === "export" ? "Generating…" : pdfReady ? "Download PDF" : "Export PDF"}
            </span>
          </Button>
        </div>
      </div>

      {/* PDF-ready badge */}
      {pdfReady && (
        <div className="flex items-center gap-2 text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 w-fit">
          <FileText className="h-3.5 w-3.5 shrink-0" />
          PDF ready — <strong>Download PDF</strong> or <strong>Share PDF</strong> instantly.
        </div>
      )}

      {/* ── Report (PDF capture target) ───────────────────────────────────── */}
      <div ref={reportRef}>
        <ProjectReportView
          projects={data.projects}
          position={data.position}
          industry={data.industry}
          experienceLevel={data.experienceLevel}
          createdAt={data.createdAt}
        />
      </div>

      <OutOfCreditsDialog
        open={showOutOfCredits}
        onOpenChange={setShowOutOfCredits}
        onGetCredits={() => navigate("/billing")}
      />
    </div>
  );
}
