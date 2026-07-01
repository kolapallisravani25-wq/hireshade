import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchQuestionDetail } from "../api";
import type { QuestionDetail } from "../types";
import { QuestionDetailContent } from "./QuestionDetailContent";

interface QuestionDetailSheetProps {
  questionId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function QuestionDetailSheet({
  questionId,
  onOpenChange,
}: QuestionDetailSheetProps) {
  const { getToken } = useAuth();
  const [loadedForId, setLoadedForId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derive display values — stale data is invisible when questionId changes
  const loading = !!questionId && loadedForId !== questionId;
  const displayDetail = loadedForId === questionId ? detail : null;
  const displayError = loadedForId === questionId ? error : null;

  useEffect(() => {
    if (!questionId) return;

    let active = true;
    fetchQuestionDetail(getToken, questionId)
      .then((result) => {
        if (active) {
          setDetail(result);
          setError(null);
          setLoadedForId(questionId);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load question details",
          );
          setLoadedForId(questionId);
        }
      });

    return () => {
      active = false;
    };
  }, [getToken, questionId]);

  return (
    <Sheet
      open={questionId !== null}
      onOpenChange={(open) => onOpenChange(open)}
    >
      <SheetContent className="w-[92vw] overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Question details</SheetTitle>
          <SheetDescription>
            Privacy-safe aggregated interview intelligence
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-6 w-2/3 rounded bg-muted" />
              <div className="h-24 rounded bg-muted" />
              <div className="h-40 rounded bg-muted" />
            </div>
          ) : null}
          {displayError ? (
            <p className="text-sm text-destructive">{displayError}</p>
          ) : null}
          {displayDetail ? <QuestionDetailContent detail={displayDetail} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

