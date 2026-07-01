import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { ProjectResponse, ProjectSection } from "@/components/AI projects/ProjectReportView";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProjectRecord {
  id: string;
  userId: string;
  position: string;
  jobDescription: string;
  resumeId: string | null;
  projects: ProjectResponse[];
  createdAt: string;
  updatedAt?: string;
}

export type GenerationStatus = "idle" | "generating" | "success" | "error";

export interface AIProjectsState {
  // ── Generation form ──────────────────────────────────────────────────────
  formPosition:        string;
  formIndustry:        string;
  formExperienceLevel: string;
  formJobDescription:  string;
  formResumeId:        string | null;
  formGenerationMode:  "new" | "resume_enhanced";

  // ── Streaming state ──────────────────────────────────────────────────────
  generationStatus: GenerationStatus;
  generationError:  string | null;
  /** Projects being assembled in real-time as they stream in */
  streamingProjects: ProjectResponse[];
  /** DB record ID returned after generation is persisted */
  savedRecordId: string | null;

  // ── Project list ─────────────────────────────────────────────────────────
  projectList:   ProjectRecord[];
  listLoading:   boolean;
  listError:     string | null;

  // ── Currently viewed project ─────────────────────────────────────────────
  activeProjectRecord: ProjectRecord | null;
  /** Index of the project tab (0–2) within the active record */
  activeProjectIndex: number;

  // ── Edit-component state ─────────────────────────────────────────────────
  editingSectionKey:   string | null;
  editSectionLoading:  boolean;
  editSectionError:    string | null;

  // ── PDF state (per record ID) ─────────────────────────────────────────────
  // Keyed by projectId so navigation away and back preserves the cached URL.
  pdfByRecord: Record<string, {
    /** Base64 data-URL of the generated PDF — null until generated */
    dataUrl: string | null;
    /** true once a PDF has been generated and is ready to download/share */
    ready: boolean;
    /** Which button triggered the in-flight generation, or null when idle */
    busyFor: "export" | "share" | null;
  }>;

  // ── Regenerating state (per record ID) ────────────────────────────────────
  regeneratingIds: Record<string, boolean>;

  // ── Regen-in-progress job (shown in the table while user is redirected) ─────
  // Null when no regen is running; set on "Regenerate" click, cleared on finish/error.
  regenJob: {
    recordId: string;
    position: string;
    industry: string;
    count: number;         // projects streamed so far (0–3)
    status: "generating" | "error";
    error?: string;
  } | null;
}

// ─── Initial State ──────────────────────────────────────────────────────────

const initialState: AIProjectsState = {
  formPosition:        "",
  formIndustry:        "",
  formExperienceLevel: "",
  formJobDescription:  "",
  formResumeId:        null,
  formGenerationMode:  "new",

  generationStatus:  "idle",
  generationError:   null,
  streamingProjects: [],
  savedRecordId:     null,

  projectList:   [],
  listLoading:   false,
  listError:     null,

  activeProjectRecord: null,
  activeProjectIndex:  0,

  editingSectionKey:  null,
  editSectionLoading: false,
  editSectionError:   null,

  pdfByRecord:     {},
  regeneratingIds: {},
  regenJob:        null,
};

// ─── Slice ──────────────────────────────────────────────────────────────────

const aiProjectsSlice = createSlice({
  name: "aiProjects",
  initialState,
  reducers: {
    // ── Form ─────────────────────────────────────────────────────────────
    setFormPosition(state, action: PayloadAction<string>) {
      state.formPosition = action.payload;
    },
    setFormIndustry(state, action: PayloadAction<string>) {
      state.formIndustry = action.payload;
    },
    setFormExperienceLevel(state, action: PayloadAction<string>) {
      state.formExperienceLevel = action.payload;
    },
    setFormJobDescription(state, action: PayloadAction<string>) {
      state.formJobDescription = action.payload;
    },
    setFormResumeId(state, action: PayloadAction<string | null>) {
      state.formResumeId = action.payload;
    },
    setFormGenerationMode(state, action: PayloadAction<"new" | "resume_enhanced">) {
      state.formGenerationMode = action.payload;
    },

    // ── Generation lifecycle ──────────────────────────────────────────────
    startGeneration(state) {
      state.generationStatus  = "generating";
      state.generationError   = null;
      state.streamingProjects = [];
      state.savedRecordId     = null;
    },
    addStreamedProject(state, action: PayloadAction<ProjectResponse>) {
      state.streamingProjects.push(action.payload);
    },
    finishGeneration(state, action: PayloadAction<{ recordId?: string }>) {
      state.generationStatus = "success";
      state.savedRecordId    = action.payload.recordId ?? null;
    },
    setGenerationError(state, action: PayloadAction<string>) {
      state.generationStatus = "error";
      state.generationError  = action.payload;
    },
    resetGeneration(state) {
      state.generationStatus  = "idle";
      state.generationError   = null;
      state.streamingProjects = [];
      state.savedRecordId     = null;
    },

    // ── Project list ──────────────────────────────────────────────────────
    setListLoading(state, action: PayloadAction<boolean>) {
      state.listLoading = action.payload;
    },
    setProjectList(state, action: PayloadAction<ProjectRecord[]>) {
      state.projectList = action.payload;
      state.listLoading = false;
      state.listError   = null;
    },
    setListError(state, action: PayloadAction<string>) {
      state.listError   = action.payload;
      state.listLoading = false;
    },
    prependProjectRecord(state, action: PayloadAction<ProjectRecord>) {
      state.projectList.unshift(action.payload);
    },

    // ── Active project ────────────────────────────────────────────────────
    setActiveProjectRecord(state, action: PayloadAction<ProjectRecord | null>) {
      state.activeProjectRecord = action.payload;
      state.activeProjectIndex  = 0;
    },
    setActiveProjectIndex(state, action: PayloadAction<number>) {
      state.activeProjectIndex = action.payload;
    },

    // ── Edit component ────────────────────────────────────────────────────
    startEditSection(state, action: PayloadAction<string>) {
      state.editingSectionKey  = action.payload;
      state.editSectionLoading = true;
      state.editSectionError   = null;
    },
    applyEditedSection(
      state,
      action: PayloadAction<{ sectionKey: string; value: unknown }>,
    ) {
      const { sectionKey, value } = action.payload;
      state.editSectionLoading = false;
      state.editingSectionKey  = null;

      const patchSections = (p: ProjectResponse): ProjectResponse => ({
        ...p,
        sections: Array.isArray(p.sections)
          ? p.sections.map((s) =>
              s.key === sectionKey ? { ...s, content: value } : s,
            )
          : p.sections,
      });

      if (state.activeProjectRecord) {
        state.activeProjectRecord.projects =
          state.activeProjectRecord.projects.map(patchSections);
      }
      state.streamingProjects = state.streamingProjects.map(patchSections);
    },
    setEditSectionError(state, action: PayloadAction<string>) {
      state.editSectionLoading = false;
      state.editSectionError   = action.payload;
    },
    clearEditSection(state) {
      state.editingSectionKey  = null;
      state.editSectionLoading = false;
      state.editSectionError   = null;
    },

    // ── PDF per record ────────────────────────────────────────────────────
    /** Mark a PDF operation as in-flight for a specific record */
    setPdfBusy(
      state,
      action: PayloadAction<{ id: string; busyFor: "export" | "share" | null }>,
    ) {
      const { id, busyFor } = action.payload;
      if (!state.pdfByRecord[id]) {
        state.pdfByRecord[id] = { dataUrl: null, ready: false, busyFor: null };
      }
      state.pdfByRecord[id].busyFor = busyFor;
    },
    /** Store the generated PDF data-URL and mark it ready */
    setPdfResult(state, action: PayloadAction<{ id: string; dataUrl: string }>) {
      const { id, dataUrl } = action.payload;
      state.pdfByRecord[id] = { dataUrl, ready: true, busyFor: null };
    },
    /** Clear the in-memory PDF for a record (e.g. after regeneration) */
    clearPdfForRecord(state, action: PayloadAction<string>) {
      delete state.pdfByRecord[action.payload];
    },

    // ── Regenerating per record ───────────────────────────────────────────
    setRegenerating(state, action: PayloadAction<{ id: string; value: boolean }>) {
      const { id, value } = action.payload;
      if (value) {
        state.regeneratingIds[id] = true;
      } else {
        delete state.regeneratingIds[id];
      }
    },

    // ── Regen job (drives the in-progress row on the table page) ─────────
    setRegenJob(
      state,
      action: PayloadAction<{ recordId: string; position: string; industry: string } | null>,
    ) {
      if (!action.payload) { state.regenJob = null; return; }
      state.regenJob = { ...action.payload, count: 0, status: "generating" };
    },
    tickRegenJob(state) {
      if (state.regenJob) state.regenJob.count = Math.min(state.regenJob.count + 1, 3);
    },
    finishRegenJob(state) {
      state.regenJob = null;
    },
    errorRegenJob(state, action: PayloadAction<string>) {
      if (state.regenJob) { state.regenJob.status = "error"; state.regenJob.error = action.payload; }
    },
  },
});

export const {
  setFormPosition,
  setFormIndustry,
  setFormExperienceLevel,
  setFormJobDescription,
  setFormResumeId,
  setFormGenerationMode,
  startGeneration,
  addStreamedProject,
  finishGeneration,
  setGenerationError,
  resetGeneration,
  setListLoading,
  setProjectList,
  setListError,
  prependProjectRecord,
  setActiveProjectRecord,
  setActiveProjectIndex,
  startEditSection,
  applyEditedSection,
  setEditSectionError,
  clearEditSection,
  setPdfBusy,
  setPdfResult,
  clearPdfForRecord,
  setRegenerating,
  setRegenJob,
  tickRegenJob,
  finishRegenJob,
  errorRegenJob,
} = aiProjectsSlice.actions;

export default aiProjectsSlice.reducer;
