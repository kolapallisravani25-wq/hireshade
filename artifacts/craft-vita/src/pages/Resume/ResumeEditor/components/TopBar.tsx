import React, { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ENDPOINTS } from "@/lib/endpoints";
import { toast } from "sonner";
import type { RootState, AppDispatch } from "@/store/store";
import {
  setResumeTitle, setAutoSaveStatus, toggleAutoSave,
  setSavedResumeId, undo, redo,
} from "@/store/resumeBuilderSlice";
import {
  ChevronLeft, Save, Download, Loader2, CheckCircle2,
  AlertTriangle, Cloud, CloudOff, Undo2, Redo2,
} from "lucide-react";
import { AiActivityButton } from "./AiActivityButton";
import { withPersistedSectionValidation } from "../sectionQualityPersistence";

function sanitizePdfBaseName(value: string): string {
  return value.replace(/[^a-z0-9_\-\s]+/gi, "").trim().replace(/\s+/g, "_");
}

function buildResumePdfFilename(name: string, role: string, fallbackTitle: string): string {
  const safeName = name.trim();
  const safeRole = role.trim();
  const baseName =
    safeName && safeRole ? `${safeName} - ${safeRole}` :
    safeName ? safeName :
    safeRole ? safeRole :
    fallbackTitle.trim() || "Resume";

  return `${sanitizePdfBaseName(baseName) || "Resume"}.pdf`;
}

/**
 * Top navigation bar — title, undo/redo, auto-save toggle, PDF export, manual save.
 * Uses Redux directly; no external props required.
 */
export function TopBar() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate  = useNavigate();
  const resumeTitle    = useSelector((s: RootState) => s.resumeBuilder.resumeTitle);
  const past           = useSelector((s: RootState) => s.resumeBuilder.past);
  const future         = useSelector((s: RootState) => s.resumeBuilder.future);
  const autoSaveStatus = useSelector((s: RootState) => s.resumeBuilder.autoSaveStatus);
  const autoSaveEnabled = useSelector((s: RootState) => s.resumeBuilder.autoSaveEnabled);
  const isDirty        = useSelector((s: RootState) => s.resumeBuilder.isDirty);
  const savedResumeId  = useSelector((s: RootState) => s.resumeBuilder.savedResumeId);
  const fields         = useSelector((s: RootState) => s.resumeBuilder.fields);
  const sections       = useSelector((s: RootState) => s.resumeBuilder.sections);
  const templateId     = useSelector((s: RootState) => s.resumeBuilder.templateId);
  const jobDescription = useSelector((s: RootState) => s.resumeBuilder.jobDescription);
  const jobTitle       = useSelector((s: RootState) => s.resumeBuilder.jobTitle);
  const company        = useSelector((s: RootState) => s.resumeBuilder.company);
  const sectionValidation = useSelector((s: RootState) => s.resumeBuilder.sectionValidation);
  const populatedHtml  = useSelector((s: RootState) => s.resumeBuilder.populatedHtml);
  const { getToken }   = useAuth();
  const [isExporting, setIsExporting] = useState(false);

  const handleSave = useCallback(async () => {
    dispatch(setAutoSaveStatus("saving"));
    try {
      const userId = localStorage.getItem("userId");
      const token = await getToken();
      const fieldsForSave = withPersistedSectionValidation(fields, sectionValidation);
      const res = await fetch(ENDPOINTS.resumeBuilderSave(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId, resumeId: savedResumeId ?? null, title: resumeTitle,
          templateId, fields: fieldsForSave, sections, jobDescription, jobTitle, company, status: "draft",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      if (!savedResumeId && data.id) dispatch(setSavedResumeId(data.id));
      dispatch(setAutoSaveStatus("saved"));
    } catch (err) {
      console.error("[TopBar] save error:", err);
      dispatch(setAutoSaveStatus("error"));
    }
  }, [dispatch, getToken, savedResumeId, resumeTitle, templateId, fields, sectionValidation, sections, jobDescription, jobTitle, company]);

  const handleExportPdf = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    const exportToast = toast.loading("Generating PDF…");
    const stage2 = setTimeout(() => toast.loading("Optimizing layout…",  { id: exportToast }), 700);
    const stage3 = setTimeout(() => toast.loading("Preparing download…", { id: exportToast }), 1500);
    const _t0 = performance.now();
    const _dbg = (label: string) =>
      console.info(`[PDF-DBG] ${label} +${(performance.now() - _t0).toFixed(0)}ms`);
    try {
      const userId = localStorage.getItem("userId");
      _dbg("getToken start");
      let token = await getToken();
      if (!token) token = await getToken({ skipCache: true });
      if (!token) throw new Error("Session expired — please refresh the page and try again");
      _dbg(`getToken done, htmlBytes=${JSON.stringify({ userId, resumeId: savedResumeId, populatedHtml: populatedHtml || undefined }).length}`);
      const filename = buildResumePdfFilename(fields?.name || "", fields?.role || jobTitle || "", resumeTitle);
      const res = await fetch(ENDPOINTS.resumeBuilderExportPdf(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId,
          resumeId: savedResumeId,
          populatedHtml: populatedHtml || undefined,
          suggestedFilename: filename.replace(/\.pdf$/i, ""),
        }),
      });
      _dbg(`fetch response received status=${res.status}`);

      if (!res.ok) {
        let code: string | undefined;
        let baseMsg = "Export failed";
        try { const data = await res.json(); code = data?.code; baseMsg = data?.error || baseMsg; } catch { /* keep generic */ }
        const friendlyMsg =
          code === "PDF_TIMEOUT"            ? "PDF render timed out — please try again" :
          code === "BROWSER_CRASH"          ? "PDF renderer crashed — please try again" :
          code === "TEMPLATE_RENDER_ERROR"  ? "Resume template failed to render" :
          baseMsg;
        throw new Error(friendlyMsg);
      }

      const blob   = await res.blob();
      _dbg(`blob() done, size=${blob.size}`);

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
      _dbg("download triggered — done");
      clearTimeout(stage2); clearTimeout(stage3);
      toast.success("PDF downloaded", { id: exportToast });

      if (savedResumeId && !isDirty) {
        try {
          await fetch(ENDPOINTS.resumeBuilderComplete(savedResumeId), {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ userId }),
          });
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      console.error("[TopBar] PDF export error:", err);
      clearTimeout(stage2); clearTimeout(stage3);
      toast.error(err instanceof Error ? err.message : "PDF export failed", {
        id: exportToast,
        action: { label: "Retry", onClick: () => handleExportPdf() },
      });
    } finally {
      setIsExporting(false);
    }
  }, [getToken, savedResumeId, isDirty, populatedHtml, resumeTitle, isExporting]);

  const saveLabel = (() => {
    if (autoSaveStatus === "saving") return { icon: <Loader2 className="h-3 w-3 animate-spin" />, text: "Saving…", cls: "text-muted-foreground" };
    if (autoSaveStatus === "saved")  return { icon: <CheckCircle2 className="h-3 w-3 text-emerald-500" />, text: "Saved", cls: "text-emerald-600 font-medium" };
    if (autoSaveStatus === "error")  return { icon: <AlertTriangle className="h-3 w-3 text-destructive" />, text: "Save failed", cls: "text-destructive font-medium" };
    if (isDirty && !autoSaveEnabled) return { icon: <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />, text: "Unsaved", cls: "text-amber-600 font-medium" };
    if (isDirty)                      return { icon: <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 animate-pulse" />, text: "Unsaved", cls: "text-amber-600 font-medium" };
    return null;
  })();

  return (
    <header className="flex items-center gap-2 px-5 border-b border-slate-200/70 bg-white shrink-0 h-[52px]">
      <button
        onClick={() => navigate("/resume/build")}
        className="flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-900 transition-colors duration-150 shrink-0 h-8 px-2 rounded-md hover:bg-slate-100"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="font-medium">Back</span>
      </button>

      <div className="h-4 w-px bg-slate-200 shrink-0" />

      <div className="flex items-center gap-1.5 min-w-0">
        {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />}
        <input
          value={resumeTitle}
          onChange={(e) => dispatch(setResumeTitle(e.target.value))}
          className="text-[13px] font-medium bg-transparent border-none outline-none focus:ring-1 focus:ring-slate-300 rounded-md px-2 py-1 text-slate-800 min-w-0 w-44"
          aria-label="Resume title"
        />
      </div>

      <div className="h-4 w-px bg-slate-200 shrink-0" />

      <div className="flex items-center gap-0.5 shrink-0">
        <button onClick={() => dispatch(undo())} disabled={past.length === 0} title="Undo (⌘Z)" className="h-7 w-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors duration-150">
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => dispatch(redo())} disabled={future.length === 0} title="Redo (⌘Y)" className="h-7 w-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors duration-150">
          <Redo2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 ml-1">
        <button
          onClick={() => dispatch(toggleAutoSave())}
          title={autoSaveEnabled ? "Auto-save is ON — click to disable" : "Auto-save is OFF — click to enable"}
          className={cn(
            "flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold border transition-all",
            autoSaveEnabled
              ? "bg-emerald-50/80 border-emerald-200/70 text-emerald-700 hover:bg-emerald-50"
              : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100",
          )}
        >
          {autoSaveEnabled ? <Cloud className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
          <span>{autoSaveEnabled ? "Auto-save" : "Manual"}</span>
        </button>
        {saveLabel && (
          <div className={cn("flex items-center gap-1.5 text-xs", saveLabel.cls)}>
            {saveLabel.icon}
            <span>{saveLabel.text}</span>
          </div>
        )}
      </div>

      <div className="flex-1" />

      <AiActivityButton />

      <button
        onClick={handleExportPdf}
        disabled={!savedResumeId || isExporting}
        title={savedResumeId ? "Export as PDF" : "Save your resume first to export PDF"}
        className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-slate-200 text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors duration-150 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {isExporting ? "Exporting…" : "PDF"}
      </button>

      <button
        onClick={handleSave}
        disabled={autoSaveStatus === "saving"}
        className="flex items-center gap-1.5 h-8 px-4 rounded-md bg-slate-900 hover:bg-slate-700 text-white text-[13px] font-medium transition-colors duration-150 shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {autoSaveStatus === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Save
      </button>
    </header>
  );
}
