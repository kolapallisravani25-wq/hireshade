import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  Check,
  ChevronDown,
  History,
  Loader2,
  RefreshCw,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AnswerApiError,
  type AnswerEditMode,
  type AnswerRevision,
  applyAnswer,
  getAnswerRevisions,
  restoreAnswerRevision,
  streamAnswerPreview,
} from "../post-session-answer.api";
import { TranscriptAnswerMarkdown } from "./TranscriptAnswerMarkdown";

interface PostSessionAnswerEditorProps {
  sessionId: string;
  messageId: string;
  question: string;
  answer: string;
  onClose: () => void;
  onApplied: (answer: string, version: number) => void;
}

function sourceLabel(source: string): string {
  return source
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function PostSessionAnswerEditor({
  sessionId,
  messageId,
  question,
  answer,
  onClose,
  onApplied,
}: PostSessionAnswerEditorProps) {
  const { getToken } = useAuth();
  const abortRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState(answer);
  const [manualView, setManualView] = useState<"edit" | "preview">("edit");
  const [baseVersion, setBaseVersion] = useState(0);
  const [revisions, setRevisions] = useState<AnswerRevision[]>([]);
  const [loadingState, setLoadingState] = useState(true);
  const [saving, setSaving] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState("");
  const [previewMode, setPreviewMode] = useState<AnswerEditMode | null>(null);
  const [previewModel, setPreviewModel] = useState<string | undefined>();
  const [customInstruction, setCustomInstruction] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadState = useCallback(async () => {
    setLoadingState(true);
    try {
      const state = await getAnswerRevisions(getToken, sessionId, messageId);
      setBaseVersion(state.currentVersion);
      setDraft(state.answer);
      setRevisions(state.revisions);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load answer revision state",
      );
    } finally {
      setLoadingState(false);
    }
  }, [getToken, messageId, sessionId]);

  useEffect(() => {
    void loadState();
    return () => abortRef.current?.abort();
  }, [loadState]);

  const handleApiError = useCallback(
    (error: unknown) => {
      if (
        error instanceof AnswerApiError &&
        error.code === "STALE_ANSWER_VERSION" &&
        typeof error.latestVersion === "number"
      ) {
        setBaseVersion(error.latestVersion);
        if (error.latestAnswer) setDraft(error.latestAnswer);
        setPreview("");
        toast.error("This answer changed. The latest version has been loaded.");
        void loadState();
        return;
      }
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(
        error instanceof Error ? error.message : "Unable to update answer",
      );
    },
    [loadState],
  );

  const runAiPreview = useCallback(
    async (mode: AnswerEditMode) => {
      if (mode === "custom" && !customInstruction.trim()) {
        toast.error("Enter an instruction for the custom rewrite.");
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setPreview("");
      setPreviewMode(mode);
      setPreviewModel(undefined);
      setStreaming(true);
      try {
        const result = await streamAnswerPreview(
          getToken,
          sessionId,
          messageId,
          {
            mode,
            instruction:
              mode === "custom" ? customInstruction.trim() : undefined,
            baseVersion,
          },
          (delta) => setPreview((current) => current + delta),
          controller.signal,
        );
        setPreview(result.answer);
        setPreviewModel(result.model);
      } catch (error) {
        handleApiError(error);
      } finally {
        setStreaming(false);
      }
    },
    [
      baseVersion,
      customInstruction,
      getToken,
      handleApiError,
      messageId,
      sessionId,
    ],
  );

  const saveAnswer = useCallback(
    async (
      nextAnswer: string,
      source: "manual" | "ai_rewrite" | "ai_regenerate",
    ) => {
      setSaving(true);
      try {
        const result = await applyAnswer(
          getToken,
          sessionId,
          messageId,
          {
            answer: nextAnswer,
            baseVersion,
            source,
            aiMode: previewMode || undefined,
            instruction:
              previewMode === "custom"
                ? customInstruction.trim()
                : undefined,
            model: previewModel,
          },
        );
        setDraft(result.answer);
        setBaseVersion(result.currentVersion);
        setPreview("");
        setPreviewMode(null);
        onApplied(result.answer, result.currentVersion);
        toast.success("Answer updated");
        void loadState();
      } catch (error) {
        handleApiError(error);
      } finally {
        setSaving(false);
      }
    },
    [
      baseVersion,
      customInstruction,
      getToken,
      handleApiError,
      loadState,
      messageId,
      onApplied,
      previewMode,
      previewModel,
      sessionId,
    ],
  );

  const restoreRevision = useCallback(
    async (revision: AnswerRevision) => {
      setSaving(true);
      try {
        const result = await restoreAnswerRevision(
          getToken,
          sessionId,
          messageId,
          revision.id,
          baseVersion,
        );
        setDraft(result.answer);
        setBaseVersion(result.currentVersion);
        onApplied(result.answer, result.currentVersion);
        setHistoryOpen(false);
        toast.success(`Restored version ${revision.version}`);
        void loadState();
      } catch (error) {
        handleApiError(error);
      } finally {
        setSaving(false);
      }
    },
    [
      baseVersion,
      getToken,
      handleApiError,
      loadState,
      messageId,
      onApplied,
      sessionId,
    ],
  );

  if (loadingState) {
    return (
      <div className="mt-4 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading editor...
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => void runAiPreview("improve")}
            disabled={streaming || saving}
          >
            <Sparkles className="size-4" />
            Improve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => void runAiPreview("regenerate")}
            disabled={streaming || saving}
          >
            <RefreshCw className="size-4" />
            Regenerate
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={streaming || saving}
              >
                More AI
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => void runAiPreview("shorten")}>
                Shorten
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void runAiPreview("expand")}>
                Expand
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void runAiPreview("simplify")}>
                Simplify
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            className="gap-2"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="size-4" />
            History
          </Button>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          title="Close editor"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          value={customInstruction}
          onChange={(event) => setCustomInstruction(event.target.value)}
          placeholder="Ask AI to change tone, format, emphasis..."
          disabled={streaming || saving}
        />
        <Button
          variant="secondary"
          className="shrink-0 gap-2"
          onClick={() => void runAiPreview("custom")}
          disabled={streaming || saving || !customInstruction.trim()}
        >
          <WandSparkles className="size-4" />
          Apply instruction
        </Button>
      </div>

      {preview || streaming ? (
        <section className="space-y-3 rounded-md border bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">
              AI preview
              {streaming ? (
                <Loader2 className="ml-2 inline size-3.5 animate-spin" />
              ) : null}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                abortRef.current?.abort();
                setPreview("");
                setPreviewMode(null);
              }}
            >
              Discard
            </Button>
          </div>
          <TranscriptAnswerMarkdown answer={preview} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                previewMode ? void runAiPreview(previewMode) : undefined
              }
              disabled={streaming || saving || !previewMode}
            >
              Regenerate again
            </Button>
            <Button
              size="sm"
              className="gap-2"
              onClick={() =>
                void saveAnswer(
                  preview,
                  previewMode === "regenerate"
                    ? "ai_regenerate"
                    : "ai_rewrite",
                )
              }
              disabled={streaming || saving || !preview.trim()}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Apply preview
            </Button>
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <Tabs
            value={manualView}
            onValueChange={(value) =>
              setManualView(value as "edit" | "preview")
            }
          >
            <TabsList>
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
          </Tabs>
          {manualView === "edit" ? (
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-64 resize-y font-mono text-sm leading-6"
            />
          ) : (
            <div className="min-h-64 rounded-md border p-4">
              <TranscriptAnswerMarkdown answer={draft} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveAnswer(draft, "manual")}
              disabled={saving || !draft.trim() || draft.trim() === answer.trim()}
            >
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Save answer
            </Button>
          </div>
        </section>
      )}

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-[92vw] overflow-y-auto sm:max-w-xl">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>Answer history</SheetTitle>
            <SheetDescription className="line-clamp-2">
              {question}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 p-4">
            {revisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The first saved edit will create the original revision.
              </p>
            ) : null}
            {revisions.map((revision) => (
              <article
                key={revision.id}
                className="space-y-3 rounded-md border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      Version {revision.version} · {sourceLabel(revision.source)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(revision.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {revision.version !== baseVersion ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void restoreRevision(revision)}
                      disabled={saving}
                    >
                      Restore
                    </Button>
                  ) : null}
                </div>
                {revision.instruction ? (
                  <p className="text-xs text-muted-foreground">
                    Instruction: {revision.instruction}
                  </p>
                ) : null}
                <div className="max-h-72 overflow-y-auto">
                  <TranscriptAnswerMarkdown answer={revision.answer} />
                </div>
              </article>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

