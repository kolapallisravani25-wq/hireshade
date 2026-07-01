import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { ENDPOINTS } from "@/lib/endpoints";
import type { RootState, AppDispatch } from "@/store/store";
import {
  setTemplate,
  undo,
  redo,
  setAutoSaveStatus,
  setSavedResumeId,
  initFromConfig,
} from "@/store/resumeBuilderSlice";
import type { TemplateId } from "@/store/resumeBuilderSlice";
import { Loader2, AlertCircle } from "lucide-react";

// ─── Types & helpers (all exported from types.ts) ─────────────────────────────
import {
  SESSION_CONFIG_KEY,
  smartTitle,
  configToFields,
} from "./types";
import type { TemplateItem } from "./types";

// ─── Extracted sub-components ─────────────────────────────────────────────────
import { ToolDialogShell } from "./components/ToolDialogShell";
import { TopBar } from "./components/TopBar";
import { LeftPanel } from "./components/LeftPanel";
import { CenterPanel } from "./components/CenterPanel";
import { ATSPanel } from "./components/ATSPanel";
import { JDTailorPanel } from "./components/JDTailorPanel";
import { TemplateMarketplace, RightPanel } from "./components/ResumePreviewPanels";
import { FullRewritePanel } from "./components/FullRewritePanel";
import { InjectSkillsPanel } from "./components/InjectSkillsPanel";
import { InjectKeywordsPanel } from "./components/InjectKeywordsPanel";
import { KeywordMatchPanel } from "./components/KeywordMatchPanel";
import { AIToolsStrip } from "./components/AIToolsStrip";
import type { ToolId } from "./components/AIToolsStrip";
import {
  readPersistedSectionValidation,
  stripPersistedSectionValidation,
  withPersistedSectionValidation,
} from "./sectionQualityPersistence";

// ─── PAGE ROOT ────────────────────────────────────────────────────────────────

export default function ResumeEditor() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const dispatch  = useDispatch<AppDispatch>();

  // ── Config resolution: navigation state first, sessionStorage fallback ─────
  const config = React.useMemo(() => {
    const fromNav = (location.state as any)?.config ?? null;
    if (fromNav) {
      try { sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify(fromNav)); } catch { /* private browsing */ }
      return fromNav;
    }
    try {
      const stored = sessionStorage.getItem(SESSION_CONFIG_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty         = useSelector((s: RootState) => s.resumeBuilder.isDirty);
  const fieldsKey       = useSelector((s: RootState) => JSON.stringify(s.resumeBuilder.fields));
  const sectionsKey     = useSelector((s: RootState) => JSON.stringify(s.resumeBuilder.sections));
  const resumeTitle     = useSelector((s: RootState) => s.resumeBuilder.resumeTitle);
  const autoSaveEnabled = useSelector((s: RootState) => s.resumeBuilder.autoSaveEnabled);
  const savedResumeId   = useSelector((s: RootState) => s.resumeBuilder.savedResumeId);
  const fields          = useSelector((s: RootState) => s.resumeBuilder.fields);
  const sections        = useSelector((s: RootState) => s.resumeBuilder.sections);
  const templateId      = useSelector((s: RootState) => s.resumeBuilder.templateId);
  const jobDescription  = useSelector((s: RootState) => s.resumeBuilder.jobDescription);
  const jobTitle        = useSelector((s: RootState) => s.resumeBuilder.jobTitle);
  const company         = useSelector((s: RootState) => s.resumeBuilder.company);
  const sectionValidation = useSelector((s: RootState) => s.resumeBuilder.sectionValidation);
  const { getToken }    = useAuth();

  const [templateCode, setTemplateCode] = useState<string>("");
  const [isInitialized, setIsInitialized] = useState(false);
  const [showTemplateMarket, setShowTemplateMarket] = useState(false);
  const [openTool, setOpenTool] = useState<ToolId | null>(null);
  const [jdTailorFreeRegenerate, setJdTailorFreeRegenerate] = useState(false);
  const [toolDialogVersion, setToolDialogVersion] = useState<Record<ToolId, number>>({
    ats: 0, jdtailor: 0, rewrite: 0,
    injectskills: 0, injectkeywords: 0, keywordmatch: 0,
    coverletter: 0,
  });

  const closeActiveTool  = React.useCallback(() => setOpenTool(null), []);
  const completeToolFlow = React.useCallback((tool: ToolId) => {
    setOpenTool(null);
    setToolDialogVersion((prev) => ({ ...prev, [tool]: prev[tool] + 1 }));
  }, []);

  const allTemplatesRef     = useRef<TemplateItem[]>([]);
  const [currentTemplateName, setCurrentTemplateName] = useState<string>("Classic");
  const saveTimerRef        = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showSavingTimer     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isDirtyRef          = useRef(isDirty);
  isDirtyRef.current        = isDirty;

  // ── Initialise Redux from config ───────────────────────────────────────────
  useEffect(() => {
    if (!config) { setIsInitialized(true); return; }

    const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "";
    const needsFetch =
      config.sourceType === "builder" &&
      config.resumeId &&
      (!config.fields || Object.keys(config.fields).length === 0);

    const initialize = (resolvedConfig: typeof config) => {
      const persistedSectionValidation = readPersistedSectionValidation(resolvedConfig);
      const cleanConfig = {
        ...resolvedConfig,
        fields: stripPersistedSectionValidation(resolvedConfig.fields),
      };
      const { title, fields: parsedFields } = configToFields(cleanConfig);
      const rawConfigTitle = resolvedConfig.resumeTitle || resolvedConfig.title || title;
      const finalTitle = (!rawConfigTitle || rawConfigTitle === "My Resume")
        ? smartTitle(parsedFields, title)
        : rawConfigTitle;
      const isImported = resolvedConfig.sourceType === "builder" || resolvedConfig.sourceType === "resume";
      dispatch(initFromConfig({
        title:          finalTitle,
        fields:         parsedFields,
        templateId:     resolvedConfig.templateId ?? "classic",
        sections:       Array.isArray(resolvedConfig.sections) ? resolvedConfig.sections : undefined,
        lockedFields:   isImported ? { name: true, email: true } : {},
        jobDescription: resolvedConfig.jobDescription ?? "",
        jobTitle:       resolvedConfig.jobTitle ?? "",
        company:        resolvedConfig.company ?? "",
        sectionValidation: persistedSectionValidation,
      }));
      if (resolvedConfig.resumeId) dispatch(setSavedResumeId(resolvedConfig.resumeId));

      fetch(`${backendUrl}/api/resume/all-templates`)
        .then((r) => r.json())
        .then((list: TemplateItem[]) => {
          if (!Array.isArray(list)) return;
          allTemplatesRef.current = list;
          const tid = (resolvedConfig.templateId ?? "classic").toLowerCase();
          const match =
            list.find((t) => t.id === resolvedConfig.templateId) ??
            list.find((t) => t.name.toLowerCase() === tid) ??
            list.find((t) => t.category.toLowerCase() === tid);
          if (match) {
            setCurrentTemplateName(match.name);
            setTemplateCode(resolvedConfig.templateCode ?? match.code);
          } else if (resolvedConfig.templateCode) {
            setTemplateCode(resolvedConfig.templateCode);
          }
        })
        .catch(() => { if (resolvedConfig.templateCode) setTemplateCode(resolvedConfig.templateCode); })
        .finally(() => setIsInitialized(true));
    };

    if (needsFetch) {
      getToken()
        .then((token) => fetch(`${backendUrl}/api/resume/builder/${config.resumeId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }))
        .then((r) => r.json())
        .then((data) => initialize({
          ...config,
          fields:         data.fields ?? {},
          sectionValidation: readPersistedSectionValidation(data) ?? readPersistedSectionValidation(config),
          templateId:     data.templateId ?? config.templateId,
          sections:       data.sections ?? config.sections,
          resumeTitle:    data.title ?? config.resumeTitle,
          jobDescription: data.jobDescription ?? config.jobDescription ?? "",
          jobTitle:       data.jobTitle ?? config.jobTitle ?? "",
          company:        data.company ?? config.company ?? "",
        }))
        .catch(() => initialize(config));
    } else {
      initialize(config);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Template switching ─────────────────────────────────────────────────────
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) { initializedRef.current = isInitialized; return; }
    if (!isInitialized) return;
    const list = allTemplatesRef.current;
    if (!list.length) return;
    const tid = templateId?.toLowerCase();
    const match =
      list.find((t) => t.id === templateId) ??
      list.find((t) => t.name.toLowerCase() === tid) ??
      list.find((t) => t.category.toLowerCase() === tid);
    if (match) { setTemplateCode(match.code); setCurrentTemplateName(match.name); }
  }, [templateId, isInitialized]);

  // ── Debounced auto-save ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDirtyRef.current || !autoSaveEnabled) return;
    clearTimeout(saveTimerRef.current);
    clearTimeout(showSavingTimer.current);
    showSavingTimer.current = setTimeout(async () => {
      if (!isDirtyRef.current) return;
      dispatch(setAutoSaveStatus("saving"));
      try {
        const token = await getToken();
        const fieldsForSave = withPersistedSectionValidation(fields, sectionValidation);
        const res = await fetch(ENDPOINTS.resumeBuilderSave(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            userId: localStorage.getItem("userId"),
            resumeId: savedResumeId ?? null,
            title: resumeTitle, templateId, fields: fieldsForSave, sections,
            jobDescription, jobTitle, company, status: "draft",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        if (!savedResumeId && data.id) dispatch(setSavedResumeId(data.id));
        dispatch(setAutoSaveStatus("saved"));
      } catch (err) {
        console.error("[AutoSave]", err);
        dispatch(setAutoSaveStatus("error"));
      }
    }, 2000);
    return () => { clearTimeout(saveTimerRef.current); clearTimeout(showSavingTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsKey, sectionsKey, resumeTitle, autoSaveEnabled]);

  // Keep local editor state resilient across page refreshes between saves.
  useEffect(() => {
    if (!isInitialized || !config) return;
    try {
      sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify({
        ...config,
        sourceType: config.sourceType ?? "builder",
        resumeId: savedResumeId ?? config.resumeId ?? null,
        resumeTitle,
        title: resumeTitle,
        fields,
        sectionValidation,
        sections,
        templateId,
        jobDescription,
        jobTitle,
        company,
      }));
    } catch {
      // Ignore storage failures (private mode / quota).
    }
  }, [
    isInitialized,
    config,
    savedResumeId,
    resumeTitle,
    fields,
    sectionValidation,
    sections,
    templateId,
    jobDescription,
    jobTitle,
    company,
  ]);

  // ── Keyboard undo/redo ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); dispatch(undo()); }
      if (mod && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); dispatch(redo()); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center p-8">
        <AlertCircle className="h-12 w-12 text-muted-foreground/40" />
        <p className="text-muted-foreground text-lg font-medium">No build configuration found.</p>
        <Button onClick={() => navigate("/resume/build")} variant="outline" className="rounded-xl px-8 h-11">
          Return to Builder
        </Button>
      </div>
    );
  }

  const handleTemplateSelect = (id: string, code: string) => {
    dispatch(setTemplate(id as TemplateId));
    setTemplateCode(code);
    const match = allTemplatesRef.current.find((t) => t.id === id);
    if (match) setCurrentTemplateName(match.name);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <TopBar />
      <AIToolsStrip onOpen={setOpenTool} />
      <div className="flex flex-1 overflow-hidden min-h-0">
        <LeftPanel />
        <CenterPanel />
        <RightPanel
          templateCode={templateCode}
          currentTemplateName={currentTemplateName}
          onOpenMarketplace={() => setShowTemplateMarket(true)}
        />
      </div>

      {/* AI Tool Dialogs */}
      <ToolDialogShell open={openTool === "ats"} onClose={closeActiveTool}>
        <ATSPanel key={`ats-${toolDialogVersion.ats}`} />
      </ToolDialogShell>
      <ToolDialogShell open={openTool === "jdtailor"} onClose={closeActiveTool}>
        <JDTailorPanel
          key={`jdtailor-${toolDialogVersion.jdtailor}`}
          hasFreeRegenerate={jdTailorFreeRegenerate}
          onTailorRunSuccess={() => setJdTailorFreeRegenerate(true)}
          onDone={() => completeToolFlow("jdtailor")}
        />
      </ToolDialogShell>
      <ToolDialogShell open={openTool === "rewrite"} onClose={closeActiveTool}>
        <FullRewritePanel key={`rewrite-${toolDialogVersion.rewrite}`} onDone={() => completeToolFlow("rewrite")} />
      </ToolDialogShell>
      <ToolDialogShell open={openTool === "injectskills"} onClose={closeActiveTool} className="max-w-3xl">
        <InjectSkillsPanel key={`injectskills-${toolDialogVersion.injectskills}`} onDone={() => completeToolFlow("injectskills")} />
      </ToolDialogShell>
      <ToolDialogShell open={openTool === "injectkeywords"} onClose={closeActiveTool}>
        <InjectKeywordsPanel key={`injectkeywords-${toolDialogVersion.injectkeywords}`} onDone={() => completeToolFlow("injectkeywords")} />
      </ToolDialogShell>
      <ToolDialogShell open={openTool === "keywordmatch"} onClose={closeActiveTool}>
        <KeywordMatchPanel
          key={`keywordmatch-${toolDialogVersion.keywordmatch}`}
          onDone={() => completeToolFlow("keywordmatch")}
          onOpenTool={(tool) => { setOpenTool(null); setTimeout(() => setOpenTool(tool as ToolId), 100); }}
        />
      </ToolDialogShell>

      {/* Template marketplace overlay */}
      {showTemplateMarket && (
        <TemplateMarketplace
          templates={allTemplatesRef.current}
          currentTemplateId={templateId}
          fields={fields}
          sections={sections}
          onSelect={handleTemplateSelect}
          onClose={() => setShowTemplateMarket(false)}
        />
      )}
    </div>
  );
}
