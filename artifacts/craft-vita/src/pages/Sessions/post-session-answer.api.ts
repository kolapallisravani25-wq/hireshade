export type AnswerEditMode =
  | "improve"
  | "shorten"
  | "expand"
  | "simplify"
  | "regenerate"
  | "custom";

export interface AnswerRevision {
  id: string;
  version: number;
  question: string;
  answer: string;
  source: string;
  aiMode?: string;
  instruction?: string;
  model?: string;
  createdAt: string;
}

export interface AnswerRevisionState {
  answer: string;
  currentVersion: number;
  revisions: AnswerRevision[];
}

export interface AppliedAnswer {
  answer: string;
  currentVersion: number;
  revisionId: string;
}

export class AnswerApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly latestAnswer?: string;
  readonly latestVersion?: number;

  constructor(
    message: string,
    status: number,
    body?: {
      code?: string;
      latestAnswer?: string;
      latestVersion?: number;
    },
  ) {
    super(message);
    this.name = "AnswerApiError";
    this.status = status;
    this.code = body?.code;
    this.latestAnswer = body?.latestAnswer;
    this.latestVersion = body?.latestVersion;
  }
}

type GetToken = () => Promise<string | null>;

async function authenticatedHeaders(
  getToken: GetToken,
  json: boolean,
): Promise<HeadersInit> {
  const token = await getToken();
  if (!token) throw new AnswerApiError("Authentication is required", 401);
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function throwResponseError(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    code?: string;
    latestAnswer?: string;
    latestVersion?: number;
  } | null;
  throw new AnswerApiError(
    body?.error || `Answer request failed with status ${response.status}`,
    response.status,
    body || undefined,
  );
}

export async function getAnswerRevisions(
  getToken: GetToken,
  sessionId: string,
  messageId: string,
): Promise<AnswerRevisionState> {
  const response = await fetch(
    ENDPOINTS.sessionAnswerRevisions(sessionId, messageId),
    { headers: await authenticatedHeaders(getToken, false) },
  );
  if (!response.ok) return throwResponseError(response);
  const body = (await response.json()) as {
    success: true;
    data: AnswerRevisionState;
  };
  return body.data;
}

export async function streamAnswerPreview(
  getToken: GetToken,
  sessionId: string,
  messageId: string,
  input: {
    mode: AnswerEditMode;
    instruction?: string;
    baseVersion: number;
  },
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<{ answer: string; model?: string }> {
  const response = await fetch(ENDPOINTS.sessionAnswerPreview(sessionId, messageId), {
    method: "POST",
    headers: await authenticatedHeaders(getToken, true),
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) return throwResponseError(response);
  if (!response.body) {
    throw new AnswerApiError("AI preview stream is unavailable", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let answer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const delta = decoder.decode(value, { stream: true });
    answer += delta;
    onDelta(delta);
  }
  const tail = decoder.decode();
  if (tail) {
    answer += tail;
    onDelta(tail);
  }
  return {
    answer: answer.trim(),
    model: response.headers.get("X-AI-Model") || undefined,
  };
}

export async function applyAnswer(
  getToken: GetToken,
  sessionId: string,
  messageId: string,
  input: {
    answer: string;
    baseVersion: number;
    source: "manual" | "ai_rewrite" | "ai_regenerate";
    aiMode?: AnswerEditMode;
    instruction?: string;
    model?: string;
  },
): Promise<AppliedAnswer> {
  const response = await fetch(ENDPOINTS.sessionAnswer(sessionId, messageId), {
    method: "PATCH",
    headers: await authenticatedHeaders(getToken, true),
    body: JSON.stringify(input),
  });
  if (!response.ok) return throwResponseError(response);
  const body = (await response.json()) as {
    success: true;
    data: AppliedAnswer;
  };
  return body.data;
}

export async function restoreAnswerRevision(
  getToken: GetToken,
  sessionId: string,
  messageId: string,
  revisionId: string,
  baseVersion: number,
): Promise<AppliedAnswer> {
  const response = await fetch(
    ENDPOINTS.sessionAnswerRestore(sessionId, messageId, revisionId),
    {
      method: "POST",
      headers: await authenticatedHeaders(getToken, true),
      body: JSON.stringify({ baseVersion }),
    },
  );
  if (!response.ok) return throwResponseError(response);
  const body = (await response.json()) as {
    success: true;
    data: AppliedAnswer;
  };
  return body.data;
}
import { ENDPOINTS } from "@/lib/endpoints";

