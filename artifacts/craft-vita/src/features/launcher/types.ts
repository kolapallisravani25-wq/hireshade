// ─── Shared domain types for the launcher feature ────────────────────────────

export type SessionKind = "free" | "premium";
export type Tab = "create" | "past";

export interface Resume {
  id: string;
  filename: string;
  uploadedAt: string;
}

export interface Document {
  id: string;
  filename: string;
  uploadedAt: string;
}

export interface AIProject {
  id: string;
  position: string;
  jobDescription: string;
  createdAt: string;
  projects: Array<{ projectHeader?: { title?: string } }>;
}

export interface PastSession {
  id: string;
  companyName?: string;
  position?: string;
  status: string;
  createdAt: string;
  isFree: boolean;
}

export interface SessionInfo {
  companyName: string;
  jobDescription: string;
  resumeId: string;
  documentId: string;
  language: string;
  simpleLanguage: boolean;
  extraContext: string;
  aiModel: string;
  autoGenerateAI: boolean;
  saveTranscript: boolean;
  isFree: boolean;
  projectIds: string[];
  primaryProjectId: string;
}

export const DEFAULT_SESSION_INFO: SessionInfo = {
  companyName: "",
  jobDescription: "",
  resumeId: "",
  documentId: "",
  language: "English",
  simpleLanguage: false,
  extraContext: "",
  aiModel: "anthropic/claude-haiku-4-5",
  autoGenerateAI: true,
  saveTranscript: true,
  isFree: false,
  projectIds: [],
  primaryProjectId: "",
};
