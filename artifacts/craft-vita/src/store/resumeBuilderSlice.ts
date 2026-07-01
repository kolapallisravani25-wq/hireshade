import { createSlice, PayloadAction } from "@reduxjs/toolkit";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SectionId =
  | "personalInfo"
  | "summary"
  | "experience"
  | "skills"
  | "projects"
  | "education"
  | "certifications"
  | "publications"
  | (string & {}); // allows custom section IDs like "volunteer", "languages", etc.

export interface SectionDef {
  id: SectionId;
  label: string;
  required: boolean; // if true, cannot be removed
  enabled: boolean;  // whether it's shown in the list
}

/** Flat record of every editable field in the resume. */
export interface ResumeFields {
  // Personal Info
  name: string;
  role: string;
  email: string;
  phone: string;
  location: string;
  links: string;
  // Summary
  summary: string;
  // Work Experience (raw multiline text)
  experience: string;
  // Skills
  skillsLanguages: string;
  skillsFrameworks: string;
  skillsDatabases: string;
  skillsTools: string;
  // Projects (raw multiline – blocks separated by double newline)
  projects: string;
  // Education (raw multiline)
  education: string;
  // Optional sections
  certifications: string;
  publications: string;
  /**
   * Freeform custom sections detected from uploaded resumes.
   * Stored as a JSON-serialised Record<sectionId, text>.
   * We keep it as a flat string so it serialises cleanly into the
   * existing `fields` Prisma column without schema changes.
   */
  _customSections: string;
}

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";
export type BottomTab = "editor" | "ats" | "jdtailor" | "coverletter" | "rewrite" | "injectskills" | "injectkeywords" | "keywordmatch";
export type TemplateId = "classic" | "modern" | "minimal";

// ─── Section Quality / Validation ─────────────────────────────────────────────

export interface SectionConstraints {
  minWords: number;
  maxWords: number;
  minBullets: number | null;
  maxBullets: number | null;
  reason: string;
}

export interface SectionQuality {
  score: number;
  status: "excellent" | "good" | "needs_improvement" | "poor";
  issues: string[];
  suggestions: string[];
  constraints: SectionConstraints;
  wordCount: number;
  isValidating: boolean;
}

/** Single AI action recorded in the editor's session activity log. */
export interface AiActivityEntry {
  id: string;
  operation:
    | "resume_enhance_section"
    | "resume_tailor"
    | "resume_extract_fields"
    | "resume_generate"
    | "resume_validate"
    | (string & {});
  /** Optional human label (e.g. "Work Experience") for nicer UI. */
  label?: string;
  creditsUsed: number;
  cached: boolean;
  status: "success" | "error";
  errorMessage?: string;
  createdAt: string;
}

export interface ResumeBuilderState {
  resumeTitle: string;
  templateId: TemplateId;
  zoom: number;
  activeSection: SectionId;
  sections: SectionDef[];
  /** Extra section definitions added at runtime (from detected resume data). */
  customSectionDefs: SectionDef[];
  fields: ResumeFields;
  /** Fields that are read-only (rendered with a lock icon + disabled input). */
  lockedFields: Partial<Record<keyof ResumeFields, boolean>>;
  // AI Enhance
  aiSuggestion: string | null;
  aiSuggestionFields: Partial<ResumeFields> | null;
  aiSectionId: SectionId | null;
  isEnhancing: boolean;
  /** Sections whose current content was produced by AI Enhance. */
  aiEnhancedSections: string[];
  // Undo / Redo history (stores snapshots of `fields`)
  past: ResumeFields[];
  future: ResumeFields[];
  // Persistence
  autoSaveStatus: AutoSaveStatus;
  isDirty: boolean;
  autoSaveEnabled: boolean;
  /** Backend UUID assigned after the first successful save. Null until saved. */
  savedResumeId: string | null;
  // Bottom tab mode
  activeBottomTab: BottomTab;
  // Target role / JD (from wizard step 3)
  jobDescription: string;
  jobTitle: string;
  company: string;
  /** Per-section quality data returned by the validate-section API. */
  sectionValidation: Record<string, SectionQuality>;
  // JD tailoring outcome (last successful tailor call)
  /** Sections whose content was rewritten by the most recent JD tailor run. */
  tailoredSections: string[];
  /** ISO timestamp of the most recent JD tailor success. */
  lastTailoredAt: string | null;
  /** Last keyword-match score returned by the tailor endpoint (0–100). */
  lastTailorMatchScore: number | null;
  /** Keywords found / missing from the most recent tailor diff. */
  lastTailorKeywordsMatched: string[];
  lastTailorKeywordsMissing: string[];
  /** Snapshot of fields BEFORE the last tailor run — enables before/after diff. */
  preTailorSnapshot: Partial<ResumeFields> | null;
  /** Recent AI actions taken in this editor session (newest first, capped). */
  aiActivityLog: AiActivityEntry[];
  /** Latest populated resume HTML (template + fields). Lifted from RightPanel
   *  so TopBar can use it for real PDF export without reaching into props. */
  populatedHtml: string;
  // ── New AI Feature State ──────────────────────────────────────────────────
  isRewriting: boolean;
  isInjectingSkills: boolean;
  isInjectingKeywords: boolean;
  isMatchingKeywords: boolean;
  /** Last keyword match result from the keyword-match endpoint. */
  keywordMatchResult: {
    present: string[];
    missing: string[];
    matchScore: number;
    analysedAt: string;
  } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_HISTORY = 20;

export const DEFAULT_SECTIONS: SectionDef[] = [
  { id: "personalInfo",  label: "Personal Info",   required: true,  enabled: true  },
  { id: "summary",       label: "Summary",          required: true,  enabled: true  },
  { id: "experience",    label: "Work Experience",  required: true,  enabled: true  },
  { id: "skills",        label: "Skills",           required: true,  enabled: true  },
  { id: "projects",      label: "Projects",         required: false, enabled: true  },
  { id: "education",     label: "Education",        required: true,  enabled: true  },
  { id: "certifications",label: "Certifications",   required: false, enabled: false },
  { id: "publications",  label: "Publications",     required: false, enabled: false },
];

const REQUIRED_SECTION_IDS = new Set<SectionId>([
  "personalInfo", "summary", "experience", "skills", "education",
]);

const SKILL_FIELD_ORDER: Array<keyof ResumeFields> = [
  "skillsLanguages",
  "skillsFrameworks",
  "skillsDatabases",
  "skillsTools",
];

const SKILL_SECTION_HEADING_RE = /^\s*(?:\*\*)?\s*(technical\s+skills|skills|core\s+skills|key\s+skills)\s*(?:\*\*)?\s*:?\s*$/i;

function cleanAiSkillLine(line: string): string {
  return line
    .replace(/^\s*[-*•]\s*/, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

function skillFieldFromLabel(label: string): keyof ResumeFields | null {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/\b(language|languages|programming|scripting|querying)\b/.test(normalized)) {
    return "skillsLanguages";
  }
  if (/\b(framework|frameworks|libraries|library|big data|data engineering|orchestration)\b/.test(normalized)) {
    return "skillsFrameworks";
  }
  if (/\b(database|databases|warehouse|warehouses|query engines|storage)\b/.test(normalized)) {
    return "skillsDatabases";
  }
  if (/\b(tool|tools|platform|platforms|cloud|devops|bi|governance|monitoring)\b/.test(normalized)) {
    return "skillsTools";
  }
  return null;
}

function parseEnhancedSkillsSuggestion(suggestion: string): Partial<ResumeFields> {
  const result: Partial<ResumeFields> = {};
  const unlabelledLines: string[] = [];
  const lines = suggestion
    .split("\n")
    .map(cleanAiSkillLine)
    .filter((line) => line.length > 0 && !SKILL_SECTION_HEADING_RE.test(line));

  lines.forEach((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      unlabelledLines.push(line);
      return;
    }

    const label = line.slice(0, separatorIndex);
    const value = cleanAiSkillLine(line.slice(separatorIndex + 1));
    const field = skillFieldFromLabel(label);
    if (!field || !value) {
      unlabelledLines.push(line);
      return;
    }
    result[field] = value;
  });

  if (Object.keys(result).length === 0) {
    lines.slice(0, SKILL_FIELD_ORDER.length).forEach((line, index) => {
      result[SKILL_FIELD_ORDER[index]] = line;
    });
    return result;
  }

  const missingFields = SKILL_FIELD_ORDER.filter((field) => !result[field]);
  missingFields.forEach((field, index) => {
    const fallbackValue = unlabelledLines[index];
    if (fallbackValue) result[field] = fallbackValue;
  });

  return result;
}

function normalizeSections(sections?: SectionDef[]): SectionDef[] {
  if (!sections?.length) return DEFAULT_SECTIONS.map((section) => ({ ...section }));

  const seen = new Set<SectionId>();
  const normalized = sections.map((section) => {
    seen.add(section.id);
    return { ...section };
  });

  DEFAULT_SECTIONS.forEach((section) => {
    if (seen.has(section.id)) return;
    normalized.push({
      ...section,
      enabled: REQUIRED_SECTION_IDS.has(section.id),
    });
  });

  return normalized;
}

export const EMPTY_FIELDS: ResumeFields = {
  name: "",
  role: "",
  email: "",
  phone: "",
  location: "",
  links: "",
  summary: "",
  experience: "",
  skillsLanguages: "",
  skillsFrameworks: "",
  skillsDatabases: "",
  skillsTools: "",
  projects: "",
  education: "",
  certifications: "",
  publications: "",
  _customSections: "{}",
};

function statusFromQualityScore(score: number): SectionQuality["status"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "needs_improvement";
  return "poor";
}

function promotedEnhancedQuality(existing: SectionQuality | undefined): SectionQuality {
  const score = Math.min(95, Math.max(existing?.score ?? 0, 75));
  return {
    score,
    status: statusFromQualityScore(score),
    issues: [],
    suggestions: [],
    constraints: existing?.constraints ?? {
      minWords: 30,
      maxWords: 300,
      minBullets: null,
      maxBullets: null,
      reason: "AI enhancement applied. Revalidation should not reduce the saved enhanced score.",
    },
    wordCount: existing?.wordCount ?? 0,
    isValidating: false,
  };
}

const initialState: ResumeBuilderState = {
  resumeTitle: "My Resume",
  templateId: "classic",
  zoom: 1,
  activeSection: "personalInfo",
  sections: DEFAULT_SECTIONS,
  customSectionDefs: [],
  fields: EMPTY_FIELDS,
  lockedFields: { name: true, email: true },
  aiSuggestion: null,
  aiSuggestionFields: null,
  aiSectionId: null,
  isEnhancing: false,
  aiEnhancedSections: [],
  past: [],
  future: [],
  autoSaveStatus: "idle",
  isDirty: false,
  // Read persisted preference; default to true
  autoSaveEnabled:
    typeof localStorage !== "undefined"
      ? localStorage.getItem("resume_autosave_enabled") !== "false"
      : true,
  savedResumeId: null,
  activeBottomTab: "editor",
  jobDescription: "",
  jobTitle: "",
  company: "",
  sectionValidation: {},
  tailoredSections: [],
  lastTailoredAt: null,
  lastTailorMatchScore: null,
  lastTailorKeywordsMatched: [],
  lastTailorKeywordsMissing: [],
  preTailorSnapshot: null,
  aiActivityLog: [],
  populatedHtml: "",
  isRewriting: false,
  isInjectingSkills: false,
  isInjectingKeywords: false,
  isMatchingKeywords: false,
  keywordMatchResult: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Push current fields to the undo stack and clear redo. */
function pushHistory(state: ResumeBuilderState) {
  state.past = [...state.past.slice(-MAX_HISTORY + 1), { ...state.fields }];
  state.future = [];
}

// ─── Slice ────────────────────────────────────────────────────────────────────

const resumeBuilderSlice = createSlice({
  name: "resumeBuilder",
  initialState,
  reducers: {
    /** Rename the resume. */
    setResumeTitle(state, action: PayloadAction<string>) {
      state.resumeTitle = action.payload;
      state.isDirty = true;
    },

    /** Switch the active template. */
    setTemplate(state, action: PayloadAction<TemplateId>) {
      state.templateId = action.payload;
      state.isDirty = true;
    },

    /** Zoom the live preview (clamped 0.5 – 2.0). */
    setZoom(state, action: PayloadAction<number>) {
      state.zoom = Math.max(0.5, Math.min(2, +action.payload.toFixed(2)));
    },

    /** Switch which section is being edited in the centre panel. */
    setActiveSection(state, action: PayloadAction<SectionId>) {
      state.activeSection = action.payload;
      state.aiSuggestion = null;
      state.aiSuggestionFields = null;
      state.aiSectionId = null;
    },

    /** Enable or disable an optional section. */
    toggleSection(state, action: PayloadAction<SectionId>) {
      const sec = state.sections.find((s) => s.id === action.payload);
      if (!sec || sec.required) return;
      sec.enabled = !sec.enabled;
      // If we just disabled the currently-active section, fall back to first enabled.
      if (!sec.enabled && state.activeSection === action.payload) {
        const first = state.sections.find((s) => s.enabled);
        if (first) state.activeSection = first.id;
      }
      state.isDirty = true;
    },

    /** Reorder sections: move one slot up. */
    moveSectionUp(state, action: PayloadAction<SectionId>) {
      const enabledIndices = state.sections
        .map((section, index) => ({ section, index }))
        .filter(({ section }) => section.enabled)
        .map(({ index }) => index);
      const pos = enabledIndices.findIndex((index) => state.sections[index].id === action.payload);
      if (pos > 0) {
        const idx = enabledIndices[pos];
        const prevIdx = enabledIndices[pos - 1];
        const temp = state.sections[prevIdx];
        state.sections[prevIdx] = state.sections[idx];
        state.sections[idx] = temp;
        state.isDirty = true;
      }
    },

    /** Reorder sections: move one slot down. */
    moveSectionDown(state, action: PayloadAction<SectionId>) {
      const enabledIndices = state.sections
        .map((section, index) => ({ section, index }))
        .filter(({ section }) => section.enabled)
        .map(({ index }) => index);
      const pos = enabledIndices.findIndex((index) => state.sections[index].id === action.payload);
      if (pos >= 0 && pos < enabledIndices.length - 1) {
        const idx = enabledIndices[pos];
        const nextIdx = enabledIndices[pos + 1];
        const temp = state.sections[nextIdx];
        state.sections[nextIdx] = state.sections[idx];
        state.sections[idx] = temp;
        state.isDirty = true;
      }
    },

    /** Update a single field value (locked fields are silently ignored). */
    updateField(
      state,
      action: PayloadAction<{ field: keyof ResumeFields; value: string }>,
    ) {
      const { field, value } = action.payload;
      if (state.lockedFields[field]) return;
      pushHistory(state);
      state.fields[field] = value;
      state.isDirty = true;
    },

    /** Set the AI suggestion result for a section. */
    setAiSuggestion(
      state,
      action: PayloadAction<{
        sectionId: SectionId;
        suggestion: string;
        suggestionFields?: Partial<ResumeFields>;
      } | null>,
    ) {
      if (action.payload) {
        state.aiSuggestion = action.payload.suggestion;
        state.aiSuggestionFields = action.payload.suggestionFields ?? null;
        state.aiSectionId = action.payload.sectionId;
      } else {
        state.aiSuggestion = null;
        state.aiSuggestionFields = null;
        state.aiSectionId = null;
      }
    },

    setIsEnhancing(state, action: PayloadAction<boolean>) {
      state.isEnhancing = action.payload;
    },

    /** Mark a section as currently being validated (spinner). */
    setSectionValidating(
      state,
      action: PayloadAction<{ sectionId: string; isValidating: boolean }>,
    ) {
      const { sectionId, isValidating } = action.payload;
      if (!state.sectionValidation[sectionId]) {
        state.sectionValidation[sectionId] = {
          score: 0, status: "needs_improvement",
          issues: [], suggestions: [],
          constraints: { minWords: 30, maxWords: 300, minBullets: null, maxBullets: null, reason: "" },
          wordCount: 0, isValidating,
        };
      } else {
        state.sectionValidation[sectionId].isValidating = isValidating;
      }
    },

    /** Store the validated quality result for a section. */
    setSectionQuality(
      state,
      action: PayloadAction<{ sectionId: string; quality: Omit<SectionQuality, "isValidating"> }>,
    ) {
      const { sectionId, quality } = action.payload;
      const existing = state.sectionValidation[sectionId];
      const sectionWasEnhanced = state.aiEnhancedSections.includes(sectionId);
      const existingLooksPromoted =
        existing !== undefined &&
        existing.score >= 75 &&
        existing.issues.length === 0 &&
        existing.suggestions.length === 0;
      if ((sectionWasEnhanced || existingLooksPromoted) && existing && quality.score < existing.score) {
        state.sectionValidation[sectionId] = { ...existing, isValidating: false };
        return;
      }
      state.sectionValidation[sectionId] = { ...quality, isValidating: false };
    },

    // ── New AI Feature Reducers ───────────────────────────────────────────────

    setIsRewriting(state, action: PayloadAction<boolean>) {
      state.isRewriting = action.payload;
    },

    setIsInjectingSkills(state, action: PayloadAction<boolean>) {
      state.isInjectingSkills = action.payload;
    },

    setIsInjectingKeywords(state, action: PayloadAction<boolean>) {
      state.isInjectingKeywords = action.payload;
    },

    setIsMatchingKeywords(state, action: PayloadAction<boolean>) {
      state.isMatchingKeywords = action.payload;
    },

    setKeywordMatchResult(
      state,
      action: PayloadAction<{ present: string[]; missing: string[]; matchScore: number } | null>,
    ) {
      if (action.payload === null) {
        state.keywordMatchResult = null;
      } else {
        state.keywordMatchResult = { ...action.payload, analysedAt: new Date().toISOString() };
      }
    },

    /**
     * Applies rewritten fields from the full-rewrite or inject-keywords endpoint.
     * Skips empty values and locked fields. Pushes to undo history.
     */
    applyRewrittenFields(
      state,
      action: PayloadAction<{ fields: Partial<ResumeFields> }>,
    ) {
      const { fields } = action.payload;
      pushHistory(state);
      (Object.keys(fields) as Array<keyof ResumeFields>).forEach((key) => {
        const next = fields[key];
        if (typeof next !== "string" || next.trim() === "") return;
        if (state.lockedFields[key]) return;
        state.fields[key] = next;
      });
      state.isDirty = true;
    },

    /**
     * Applies injected skills fields. Only updates the 4 skills sub-fields.
     * Preserves locked fields and pushes undo history.
     */
    applyInjectedSkills(
      state,
      action: PayloadAction<{ injectedFields: Partial<ResumeFields> }>,
    ) {
      const { injectedFields } = action.payload;
      const SKILLS_KEYS: Array<keyof ResumeFields> = [
        "skillsLanguages", "skillsFrameworks", "skillsDatabases", "skillsTools",
      ];
      pushHistory(state);
      SKILLS_KEYS.forEach((key) => {
        const next = injectedFields[key];
        if (typeof next !== "string" || next.trim() === "") return;
        if (state.lockedFields[key]) return;
        state.fields[key] = next;
      });
      state.isDirty = true;
    },

    /** Apply the current AI suggestion to the fields. */
    applyAiSuggestion(state) {
      if (!state.aiSuggestion || !state.aiSectionId) return;
      pushHistory(state);
      switch (state.aiSectionId) {
        case "personalInfo":
          // AI returns an improved professional title — write it to the role field
          state.fields.role = state.aiSuggestion;
          break;
        case "summary":
          state.fields.summary = state.aiSuggestion;
          break;
        case "experience":
          state.fields.experience = state.aiSuggestion;
          break;
        case "skills": {
          const parsedSkills = state.aiSuggestionFields ?? parseEnhancedSkillsSuggestion(state.aiSuggestion);
          SKILL_FIELD_ORDER.forEach((field) => {
            const value = parsedSkills[field];
            if (typeof value === "string" && value.trim().length > 0) {
              state.fields[field] = value;
            }
          });
          break;
        }
        case "projects":
          state.fields.projects = state.aiSuggestion;
          break;
        case "education":
          state.fields.education = state.aiSuggestion;
          break;
        case "certifications":
          state.fields.certifications = state.aiSuggestion;
          break;
        case "publications":
          state.fields.publications = state.aiSuggestion;
          break;
        default:
          break;
      }
      if (state.aiSectionId && !state.aiEnhancedSections.includes(state.aiSectionId)) {
        state.aiEnhancedSections.push(state.aiSectionId);
      }
      if (state.aiSectionId) {
        state.sectionValidation[state.aiSectionId] = promotedEnhancedQuality(
          state.sectionValidation[state.aiSectionId],
        );
      }
      state.aiSuggestion = null;
      state.aiSuggestionFields = null;
      state.aiSectionId = null;
      state.isDirty = true;
    },

    discardAiSuggestion(state) {
      state.aiSuggestion = null;
      state.aiSuggestionFields = null;
      state.aiSectionId = null;
    },

    /**
     * Bulk-apply a tailored-fields payload returned by `/resume/builder/tailor`.
     * Snapshots prior values so the user can revert (before/after diff). Only
     * fields present in the payload are touched — empty/undefined entries are
     * skipped so the AI cannot accidentally erase user content.
     */
    applyTailoredFields(
      state,
      action: PayloadAction<{
        tailoredFields: Partial<ResumeFields>;
        keywordsMatched?: string[];
        keywordsMissing?: string[];
        matchScore?: number;
      }>,
    ) {
      const { tailoredFields, keywordsMatched, keywordsMissing, matchScore } = action.payload;
      pushHistory(state);

      // Snapshot only the fields we are about to overwrite so revert is exact.
      const snapshot: Partial<ResumeFields> = {};
      const touched: string[] = [];
      const FIELD_TO_SECTION: Record<string, string> = {
        role:              "personalInfo",
        location:          "personalInfo",
        summary:           "summary",
        experience:        "experience",
        skillsLanguages:   "skills",
        skillsFrameworks:  "skills",
        skillsDatabases:   "skills",
        skillsTools:       "skills",
        projects:          "projects",
        education:         "education",
        certifications:    "certifications",
        publications:      "publications",
      };

      (Object.keys(tailoredFields) as Array<keyof ResumeFields>).forEach((key) => {
        const next = tailoredFields[key];
        if (typeof next !== "string" || next.trim() === "") return;
        if (state.lockedFields[key]) return;
        snapshot[key] = state.fields[key];
        state.fields[key] = next;
        const sectionId = FIELD_TO_SECTION[key as string];
        if (sectionId && !touched.includes(sectionId)) touched.push(sectionId);
      });

      state.preTailorSnapshot = snapshot;
      state.tailoredSections = touched;
      state.lastTailoredAt = new Date().toISOString();
      state.lastTailorMatchScore = typeof matchScore === "number" ? matchScore : null;
      state.lastTailorKeywordsMatched = keywordsMatched ?? [];
      state.lastTailorKeywordsMissing = keywordsMissing ?? [];
      state.isDirty = true;
    },

    /** Revert the most recent tailor run, restoring snapshotted field values. */
    revertTailor(state) {
      if (!state.preTailorSnapshot) return;
      pushHistory(state);
      (Object.keys(state.preTailorSnapshot) as Array<keyof ResumeFields>).forEach((key) => {
        const prev = state.preTailorSnapshot![key];
        if (typeof prev === "string") state.fields[key] = prev;
      });
      state.preTailorSnapshot = null;
      state.tailoredSections = [];
      state.isDirty = true;
    },

    /** Clear the tailor success banner without touching the resume content. */
    clearTailorOutcome(state) {
      state.tailoredSections = [];
      state.lastTailoredAt = null;
      state.lastTailorMatchScore = null;
      state.lastTailorKeywordsMatched = [];
      state.lastTailorKeywordsMissing = [];
      state.preTailorSnapshot = null;
    },

    /** Update target-job context (role / company / JD text) used by JD Tailor. */
    setJobContext(
      state,
      action: PayloadAction<{ jobTitle?: string; company?: string; jobDescription?: string }>,
    ) {
      const { jobTitle, company, jobDescription } = action.payload;
      if (typeof jobTitle === "string")       state.jobTitle = jobTitle;
      if (typeof company === "string")        state.company = company;
      if (typeof jobDescription === "string") state.jobDescription = jobDescription;
    },

    /**
     * Append an AI action to the editor's session activity log. Capped at 50
     * entries (oldest dropped) to keep the drawer snappy. Persisted across
     * tab navigations within a session but cleared on `initFromConfig`.
     */
    recordAiActivity(state, action: PayloadAction<Omit<AiActivityEntry, "id" | "createdAt">>) {
      const entry: AiActivityEntry = {
        id: typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        ...action.payload,
      };
      state.aiActivityLog = [entry, ...state.aiActivityLog].slice(0, 50);
    },

    clearAiActivity(state) {
      state.aiActivityLog = [];
    },

    /** RightPanel writes the rendered preview HTML here so TopBar can export it. */
    setPopulatedHtml(state, action: PayloadAction<string>) {
      state.populatedHtml = action.payload;
    },

    /** Step back one change in history. */
    undo(state) {
      if (state.past.length === 0) return;
      const prev = state.past[state.past.length - 1];
      state.future = [{ ...state.fields }, ...state.future.slice(0, MAX_HISTORY - 1)];
      state.past = state.past.slice(0, -1);
      state.fields = prev;
    },

    /** Step forward one change in history. */
    redo(state) {
      if (state.future.length === 0) return;
      const next = state.future[0];
      state.past = [...state.past.slice(-MAX_HISTORY + 1), { ...state.fields }];
      state.future = state.future.slice(1);
      state.fields = next;
    },

    setAutoSaveStatus(state, action: PayloadAction<AutoSaveStatus>) {
      state.autoSaveStatus = action.payload;
      if (action.payload === "saved") state.isDirty = false;
    },

    toggleAutoSave(state) {
      state.autoSaveEnabled = !state.autoSaveEnabled;
      try {
        localStorage.setItem(
          "resume_autosave_enabled",
          state.autoSaveEnabled ? "true" : "false",
        );
      } catch {/* private browsing */}
    },

    setSavedResumeId(state, action: PayloadAction<string | null>) {
      state.savedResumeId = action.payload;
    },

    setActiveBottomTab(state, action: PayloadAction<BottomTab>) {
      state.activeBottomTab = action.payload;
    },

    /**
     * Add a custom section (e.g. detected from uploaded resume).
     * Skips if the sectionId already exists in sections or customSectionDefs.
     */
    addCustomSection(
      state,
      action: PayloadAction<{ id: string; label: string; content?: string }>,
    ) {
      const { id, label, content = "" } = action.payload;
      const alreadyInCore   = state.sections.some((s) => s.id === id);
      const alreadyInCustom = state.customSectionDefs.some((s) => s.id === id);
      if (alreadyInCore || alreadyInCustom) return;
      state.customSectionDefs.push({ id, label, required: false, enabled: true });
      // Store content in _customSections JSON blob
      try {
        const map = JSON.parse(state.fields._customSections || "{}") as Record<string, string>;
        if (!map[id]) map[id] = content;
        state.fields._customSections = JSON.stringify(map);
      } catch { /* ignore */ }
      state.isDirty = true;
    },

    /** Remove a custom section entirely. */
    removeCustomSection(state, action: PayloadAction<string>) {
      const id = action.payload;
      state.customSectionDefs = state.customSectionDefs.filter((s) => s.id !== id);
      try {
        const map = JSON.parse(state.fields._customSections || "{}") as Record<string, string>;
        delete map[id];
        state.fields._customSections = JSON.stringify(map);
      } catch { /* ignore */ }
      if (state.activeSection === id) {
        const first = state.sections.find((s) => s.enabled) ?? state.customSectionDefs[0];
        if (first) state.activeSection = first.id;
      }
      state.isDirty = true;
    },

    /** Toggle a custom section's enabled state. */
    toggleCustomSection(state, action: PayloadAction<string>) {
      const id = action.payload;
      const sec = state.customSectionDefs.find((s) => s.id === id);
      if (!sec) return;
      sec.enabled = !sec.enabled;
      if (!sec.enabled && state.activeSection === id) {
        const first = state.sections.find((s) => s.enabled) ?? state.customSectionDefs.find((s) => s.enabled);
        if (first) state.activeSection = first.id;
      }
      state.isDirty = true;
    },

    /** Update the text content of a custom section. */
    updateCustomField(state, action: PayloadAction<{ id: string; value: string }>) {
      const { id, value } = action.payload;
      try {
        const map = JSON.parse(state.fields._customSections || "{}") as Record<string, string>;
        map[id] = value;
        state.fields._customSections = JSON.stringify(map);
      } catch { /* ignore */ }
      state.isDirty = true;
    },

    /**
     * Initialise (or reset) the editor from a parsed resume config.
     * Called when the page mounts with location.state.config.
     */
    initFromConfig(
      state,
      action: PayloadAction<{
        title?: string;
        fields?: Partial<ResumeFields>;
        templateId?: TemplateId;
        lockedFields?: Partial<Record<keyof ResumeFields, boolean>>;
        jobDescription?: string;
        jobTitle?: string;
        company?: string;
        sections?: SectionDef[];
        customSectionDefs?: SectionDef[];
        sectionValidation?: Record<string, SectionQuality>;
      }>,
    ) {
      const {
        title,
        fields,
        templateId,
        lockedFields,
        jobDescription,
        jobTitle,
        company,
        sections,
        customSectionDefs,
        sectionValidation,
      } = action.payload;
      if (title) state.resumeTitle = title;
      if (templateId) state.templateId = templateId;
      state.sections = normalizeSections(sections);
      state.fields = { ...EMPTY_FIELDS, ...(fields ?? {}) };
      state.lockedFields = lockedFields ?? { name: true, email: true };
      state.past = [];
      state.future = [];
      state.isDirty = false;
      state.autoSaveStatus = "idle";
      state.savedResumeId = null;
      // preserve user's autosave preference across sessions
      state.activeSection = "personalInfo";
      state.aiSuggestion = null;
      state.aiSuggestionFields = null;
      state.aiSectionId = null;
      state.activeBottomTab = "editor";
      state.jobDescription = jobDescription ?? "";
      state.jobTitle = jobTitle ?? "";
      state.company = company ?? "";
      state.customSectionDefs = customSectionDefs ?? [];
      state.sectionValidation = sectionValidation ?? {};
      state.aiActivityLog = [];
      state.tailoredSections = [];
      state.lastTailoredAt = null;
      state.lastTailorMatchScore = null;
      state.lastTailorKeywordsMatched = [];
      state.lastTailorKeywordsMissing = [];
      state.preTailorSnapshot = null;
      state.keywordMatchResult = null;
    },
  },
});

export const {
  setResumeTitle,
  setTemplate,
  setZoom,
  setActiveSection,
  toggleSection,
  moveSectionUp,
  moveSectionDown,
  updateField,
  setAiSuggestion,
  setIsEnhancing,
  applyAiSuggestion,
  discardAiSuggestion,
  applyTailoredFields,
  revertTailor,
  clearTailorOutcome,
  setJobContext,
  recordAiActivity,
  clearAiActivity,
  setPopulatedHtml,
  undo,
  redo,
  setAutoSaveStatus,
  toggleAutoSave,
  setSavedResumeId,
  setActiveBottomTab,
  initFromConfig,
  addCustomSection,
  removeCustomSection,
  toggleCustomSection,
  updateCustomField,
  setSectionValidating,
  setSectionQuality,
  setIsRewriting,
  setIsInjectingSkills,
  setIsInjectingKeywords,
  setIsMatchingKeywords,
  setKeywordMatchResult,
  applyRewrittenFields,
  applyInjectedSkills,
} = resumeBuilderSlice.actions;

export default resumeBuilderSlice.reducer;
