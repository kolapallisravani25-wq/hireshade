import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";
import {
  AlertCircle,
  Brain,
  Check,
  Copy,
  Download,
  FileText,
  Lightbulb,
  MessageSquare,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAuthHeaders } from "@/lib/globalAuth";
import { AskAIWorkspace } from "./components/AskAI/AskAIWorkspace";
import { PostSessionAnswerEditor } from "./components/PostSessionAnswerEditor";
import { TranscriptAnswerMarkdown } from "./components/TranscriptAnswerMarkdown";

export interface Message {
  id?: string;
  messageId?: string;
  snapshotId?: string;
  role: string;
  content?: string;
  question?: string;
  answer?: string;
  timestamp?: string;
  createdAt?: string;
  patchedText?: string;
  answerVersion?: number;
}

interface TranscriptEntry {
  id: string;
  role: "USER" | "INTERVIEWER" | "AI_ASSISTANT";
  label: string;
  text: string;
  time: string;
  timestampMs: number;
  aiQuestion?: string;
  aiAnswer?: string;
  answerVersion?: number;
}

interface SessionNotes {
  summary: string;
  questions: string[];
}

/**
 * Map the Insights feedback object (session_feedback) to the shape the AI
 * Notes tab renders. The tab shows an executive summary + the list of key
 * topics/questions surfaced by the evaluator, which is a subset of the full
 * Insights payload already produced by GET /session/:id/analytics. Reusing
 * that endpoint means both this tab and SessionAnalyticsDialog share one
 * persisted, idempotent evaluation — no second code path, no double spend.
 */
function feedbackToNotes(feedback: unknown): SessionNotes | null {
  if (!feedback || typeof feedback !== "object") return null;
  const f = feedback as Record<string, unknown>;
  const summary = typeof f["summary"] === "string" ? (f["summary"] as string) : "";
  const keyTopics = Array.isArray(f["keyTopics"]) ? (f["keyTopics"] as string[]) : [];
  const studyAreas = Array.isArray(f["studyAreas"]) ? (f["studyAreas"] as string[]) : [];
  const questions = [...keyTopics, ...studyAreas].filter(
    (q): q is string => typeof q === "string" && q.trim().length > 0,
  );
  if (!summary && questions.length === 0) return null;
  return { summary, questions };
}

interface TranscriptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  onDelete: (id: string) => void;
}

function messageKey(message: Message, index: number): string {
  return (
    message.messageId ||
    message.id ||
    message.snapshotId ||
    `message-${index}`
  );
}

function resolveRole(
  value: unknown,
): "USER" | "INTERVIEWER" | "AI_ASSISTANT" {
  if (value === "USER") return "USER";
  if (value === "INTERVIEWER") return "INTERVIEWER";
  return "AI_ASSISTANT";
}

function resolveRoleLabel(role: TranscriptEntry["role"]): string {
  if (role === "USER") return "You";
  if (role === "INTERVIEWER") return "Interviewer";
  return "AI Assistant";
}

function resolveTime(
  message: Message,
  index: number,
): { time: string; timestampMs: number } {
  const rawTimestamp = message.timestamp || message.createdAt;
  if (rawTimestamp) {
    const parsed = new Date(rawTimestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        time: parsed.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        timestampMs: parsed.getTime(),
      };
    }
  }
  return { time: "00:00", timestampMs: index };
}

function resolveTranscriptText(
  message: Message,
  role: TranscriptEntry["role"],
): string {
  if (role === "AI_ASSISTANT") {
    return (
      message.answer?.trim() ||
      message.content?.trim() ||
      message.question?.trim() ||
      ""
    );
  }
  return (
    message.patchedText?.trim() ||
    message.question?.trim() ||
    message.content?.trim() ||
    message.answer?.trim() ||
    ""
  );
}

function parseAiQuestionAnswer(message: Message): {
  question: string;
  answer: string;
} {
  const directQuestion = message.question?.trim() || "";
  const rawBody = resolveTranscriptText(message, "AI_ASSISTANT");
  if (!rawBody) {
    return { question: directQuestion || "Generated response", answer: "" };
  }

  const questionMatch = rawBody.match(
    /\*\*QUESTION:\*\*\s*([\s\S]*?)(?=\*\*ANSWER:\*\*|ANSWER:)/i,
  );
  const answerMatch = rawBody.match(/\*\*ANSWER:\*\*\s*([\s\S]*)/i);
  if (answerMatch?.[1]?.trim()) {
    return {
      question:
        questionMatch?.[1]?.replace(/\*\*/g, "").trim() ||
        directQuestion ||
        "Generated response",
      answer: answerMatch[1].trim(),
    };
  }
  return {
    question: directQuestion || "Generated response",
    answer:
      rawBody.split(/===NEXT_QUESTION===/gi)[0]?.trim() || rawBody,
  };
}

const TranscriptBubble = memo(function TranscriptBubble({
  entry,
}: {
  entry: TranscriptEntry;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 py-1 [contain:layout_paint]",
        entry.role === "USER" ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "max-w-[82%] rounded-lg bg-slate-100 px-3.5 py-2 text-[16px] leading-6 text-slate-900",
          entry.role === "USER" ? "rounded-tr-sm" : "rounded-tl-sm",
        )}
      >
        <p className="m-0 whitespace-pre-wrap">{entry.text}</p>
      </div>
      <div className="text-[10px] font-semibold text-slate-500">
        {entry.label} · {entry.time}
      </div>
    </div>
  );
});

const AiAnswerCard = memo(function AiAnswerCard({
  entry,
  sessionId,
  editing,
  copied,
  onCopy,
  onEdit,
  onCloseEditor,
  onApplied,
}: {
  entry: TranscriptEntry;
  sessionId: string;
  editing: boolean;
  copied: boolean;
  onCopy: (id: string, text: string) => void;
  onEdit: (id: string) => void;
  onCloseEditor: () => void;
  onApplied: (id: string, answer: string, version: number) => void;
}) {
  return (
    <article className="my-2 rounded-lg border border-amber-200/70 bg-white px-4 py-3 [contain:layout_paint]">
      <div className="flex items-start justify-between gap-3">
        <p className="m-0 text-[16px] leading-6 text-slate-900">
          <span className="font-bold">Question:</span>{" "}
          {entry.aiQuestion || "Generated response"}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() =>
              onCopy(
                entry.id,
                `Question: ${entry.aiQuestion || ""}\n\nAnswer:\n${entry.aiAnswer || ""}`,
              )
            }
            title="Copy answer"
          >
            {copied ? (
              <Check className="size-4 text-emerald-500" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
          <Button
            variant={editing ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => onEdit(entry.id)}
            title="Edit answer"
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      </div>

      <div className="my-3 h-px bg-slate-200" />
      <p className="m-0 text-[16px] font-bold leading-none text-slate-900">
        Answer:
      </p>
      <div className="mt-2">
        <TranscriptAnswerMarkdown answer={entry.aiAnswer || ""} />
      </div>
      <div className="mt-3 text-[10px] font-semibold text-slate-500">
        AI Answer · {entry.time}
        {entry.answerVersion ? ` · Version ${entry.answerVersion}` : ""}
      </div>

      {editing ? (
        <PostSessionAnswerEditor
          sessionId={sessionId}
          messageId={entry.id}
          question={entry.aiQuestion || "Generated response"}
          answer={entry.aiAnswer || ""}
          onClose={onCloseEditor}
          onApplied={(answer, version) =>
            onApplied(entry.id, answer, version)
          }
        />
      ) : null}
    </article>
  );
});

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <AlertCircle className="mb-4 size-7 text-muted-foreground/50" />
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {actionLabel && onAction ? (
        <Button onClick={onAction} size="sm" className="mt-5 gap-2">
          <Sparkles className="size-4" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function TranscriptDialog({
  isOpen,
  onClose,
  sessionId,
  onDelete,
}: TranscriptDialogProps) {
  const [activeTab, setActiveTab] = useState("transcript");
  const [messages, setMessages] = useState<Message[]>([]);
  const [userId, setUserId] = useState("");
  const [notes, setNotes] = useState<SessionNotes | null>(null);
  const [loadedForSessionId, setLoadedForSessionId] = useState<string | null>(null);
  const isLoading = isOpen && !!sessionId && loadedForSessionId !== sessionId;
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isEphemeral, setIsEphemeral] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const visibleStartIndexRef = useRef(0);

  useEffect(() => {
    if (!isOpen || !sessionId) return;
    let active = true;
    getAuthHeaders().then((authHeaders) => Promise.all([
      fetch(`${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}`, { headers: authHeaders }),
      fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/analytics/existing`,
        { headers: authHeaders },
      ),
    ]))
      .then(async ([sessionResponse, notesResponse]) => {
        if (sessionResponse.ok) {
          const data = await sessionResponse.json();
          const sessionData = data.data ?? data;
          const storedMessages = Array.isArray(sessionData.messages)
            ? sessionData.messages
            : [];
          const storedTranscript = Array.isArray(sessionData.transcript)
            ? sessionData.transcript
            : [];
          if (active) {
            setMessages(
              storedMessages.length > 0
                ? storedMessages
                : storedTranscript,
            );
            setUserId(sessionData.userId || "");
            setIsEphemeral(sessionData.saveTranscription === false);
          }
        }
        if (active) {
          setNotes(
            notesResponse.ok
              ? feedbackToNotes(await notesResponse.json())
              : null,
          );
        }
      })
      .catch((error) =>
        console.error("Error fetching session details:", error),
      )
      .finally(() => {
        if (active) setLoadedForSessionId(sessionId);
      });
    return () => {
      active = false;
    };
  }, [isOpen, sessionId]);

  const parsedTranscript = useMemo<TranscriptEntry[]>(() => {
    const rows: TranscriptEntry[] = [];
    messages.forEach((message, index) => {
      const role = resolveRole(message.role);
      const { time, timestampMs } = resolveTime(message, index);
      if (role === "AI_ASSISTANT") {
        const ai = parseAiQuestionAnswer(message);
        if (!ai.answer) return;
        rows.push({
          id: messageKey(message, index),
          role,
          label: resolveRoleLabel(role),
          text: ai.answer,
          aiQuestion: ai.question,
          aiAnswer: ai.answer,
          answerVersion: message.answerVersion,
          time,
          timestampMs,
        });
        return;
      }
      const text = resolveTranscriptText(message, role);
      if (!text) return;
      rows.push({
        id: messageKey(message, index),
        role,
        label: resolveRoleLabel(role),
        text,
        time,
        timestampMs,
      });
    });
    return rows.sort((left, right) => left.timestampMs - right.timestampMs);
  }, [messages]);

  const indexByMessageId = useMemo(
    () =>
      new Map(
        parsedTranscript.map((entry, index) => [entry.id, index]),
      ),
    [parsedTranscript],
  );

  const handleCopy = useCallback((id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleAnswerApplied = useCallback(
    (messageId: string, answer: string, version: number) => {
      setMessages((current) =>
        current.map((message, index) =>
          messageKey(message, index) === messageId
            ? {
                ...message,
                messageId,
                answer,
                content: `Q: ${message.question || ""}\n\nA: ${answer}`,
                answerVersion: version,
              }
            : message,
        ),
      );
    },
    [],
  );

  const handleNavigateToTimeline = useCallback(
    (interactionId: string) => {
      const index = indexByMessageId.get(interactionId);
      if (index === undefined) return;
      setActiveTab("transcript");
      window.setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({
          index,
          align: "center",
          behavior: "smooth",
        });
      }, 0);
    },
    [indexByMessageId],
  );

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value);
    if (value === "transcript") {
      window.setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({
          index: visibleStartIndexRef.current,
          align: "start",
        });
      }, 0);
    }
  }, []);

  const generateNotes = useCallback(async () => {
    setIsGenerating(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/analytics`,
        { method: "GET", headers: await getAuthHeaders() },
      );
      if (response.ok) {
        const mapped = feedbackToNotes(await response.json());
        setNotes(mapped);
        setActiveTab("ai-notes");
      } else if (response.status === 422) {
        // Not enough conversation to evaluate — surface it instead of
        // spinning forever then silently doing nothing.
        window.alert(
          "There isn't enough conversation in this session to generate insights yet.",
        );
      } else {
        window.alert("Couldn't generate insights right now. Please try again.");
      }
    } catch {
      window.alert("Couldn't generate insights right now. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }, [sessionId]);

  const downloadTranscript = useCallback(() => {
    const content = parsedTranscript
      .map((entry) => `[${entry.time}] ${entry.label}: ${entry.text}`)
      .join("\n\n");
    const blob = new Blob(
      [`# Session Transcript\nSession ID: ${sessionId}\n\n${content}`],
      { type: "text/markdown" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `transcript-${sessionId}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [parsedTranscript, sessionId]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[85vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-xl border bg-background p-0 shadow-xl sm:max-w-5xl">
        <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
          <div>
            <DialogTitle className="text-base font-semibold">
              Interview Intelligence
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {"AI-powered Session Workspace"}
              {isEphemeral ? " · Ephemeral" : ""}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {!isEphemeral ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadTranscript}
                className="gap-2"
              >
                <Download className="size-4" />
                Export
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(sessionId)}
              title="Delete session"
            >
              <Trash2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              title="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="min-h-0 flex-1"
        >
          <div className="shrink-0 border-b px-6 py-3">
            <TabsList className="grid w-full max-w-[440px] grid-cols-3">
              <TabsTrigger value="transcript" className="gap-2">
                <FileText className="size-4" />
                Transcript
              </TabsTrigger>
              <TabsTrigger value="ai-notes" className="gap-2">
                <Sparkles className="size-4" />
                Insights
              </TabsTrigger>
              <TabsTrigger value="ask-ai" className="gap-2">
                <MessageSquare className="size-4" />
                Ask AI
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="transcript"
            className="min-h-0 flex-1 bg-slate-50/30"
          >
            {isLoading ? (
              <div className="flex h-full items-center justify-center gap-3 text-sm text-muted-foreground">
                <Brain className="size-5 animate-pulse" />
                Loading transcript...
              </div>
            ) : parsedTranscript.length === 0 ? (
              <EmptyState
                title="No transcript available"
                description="Transcript messages appear here after a saved interview session."
              />
            ) : (
              <Virtuoso
                ref={virtuosoRef}
                data={parsedTranscript}
                increaseViewportBy={{ top: 350, bottom: 500 }}
                rangeChanged={(range) => {
                  visibleStartIndexRef.current = range.startIndex;
                }}
                itemContent={(_, entry) => (
                  <div className="mx-auto max-w-4xl px-6">
                    {entry.role === "AI_ASSISTANT" ? (
                      <AiAnswerCard
                        entry={entry}
                        sessionId={sessionId}
                        editing={editingMessageId === entry.id}
                        copied={copiedId === entry.id}
                        onCopy={handleCopy}
                        onEdit={(id) =>
                          setEditingMessageId((current) =>
                            current === id ? null : id,
                          )
                        }
                        onCloseEditor={() => setEditingMessageId(null)}
                        onApplied={handleAnswerApplied}
                      />
                    ) : (
                      <TranscriptBubble entry={entry} />
                    )}
                  </div>
                )}
              />
            )}
          </TabsContent>

          <TabsContent
            value="ai-notes"
            className="min-h-0 flex-1 overflow-y-auto bg-slate-50/30 p-6"
          >
            <div className="mx-auto max-w-4xl">
              {isGenerating ? (
                <div className="flex justify-center py-24 text-sm text-muted-foreground">
                  Analyzing session...
                </div>
              ) : !notes ? (
                <EmptyState
                  title="No insights generated"
                  description="Generate a summary and identify the questions discussed in this session."
                  actionLabel={!isEphemeral ? "Generate Analytics" : undefined}
                  onAction={generateNotes}
                />
              ) : (
                <div className="grid gap-5 pb-8 md:grid-cols-2">
                  <section className="rounded-lg border bg-white p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <FileText className="size-4 text-indigo-500" />
                      <h3 className="text-sm font-semibold">
                        Executive Summary
                      </h3>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {notes.summary}
                    </p>
                  </section>
                  <section className="rounded-lg border bg-white p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <Lightbulb className="size-4 text-amber-500" />
                      <h3 className="text-sm font-semibold">
                        Questions Identified
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {notes.questions.map((question, index) => (
                        <div
                          key={`${index}-${question}`}
                          className="flex gap-3 text-sm"
                        >
                          <span className="text-xs text-muted-foreground">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <p>{question}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="ask-ai" className="min-h-0 flex-1">
            <AskAIWorkspace
              sessionId={sessionId}
              internalUserId={userId}
              onNavigateToTimeline={handleNavigateToTimeline}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
