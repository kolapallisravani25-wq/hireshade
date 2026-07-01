import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchQuestionDetail } from "../api";
import type { QuestionDetail } from "../types";
import { QuestionDetailContent } from "../components/QuestionDetailContent";

function QuestionDetails() {
  const { questionId, companySlug } = useParams<{
    questionId: string;
    companySlug?: string;
  }>();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!questionId) {
      setError("Question id is missing");
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    fetchQuestionDetail(getToken, questionId)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load question details",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [getToken, questionId]);

  const backPath = companySlug
    ? `/questions/company/${companySlug}`
    : "/questions/all";

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(backPath)}
        className="gap-2"
      >
        <ArrowLeft className="size-4" />
        Back
      </Button>
      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-8 w-2/3 rounded bg-muted" />
          <div className="h-28 rounded bg-muted" />
          <div className="h-48 rounded bg-muted" />
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {detail ? <QuestionDetailContent detail={detail} /> : null}
    </div>
  );
}

export default QuestionDetails;
