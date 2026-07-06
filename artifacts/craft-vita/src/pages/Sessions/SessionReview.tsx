import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/store/hooks";
import { deleteSession } from "@/store/sessionsSlice";
import { TranscriptDialog } from "./TranscriptDialog";

/**
 * Full-page Session Review (Issue 1). Composes the existing session sub-views —
 * transcript + AI answers, Insights, Ask AI, and Analytics — into ONE page via
 * the shared TranscriptDialog workspace rendered in `asPage` mode. Reached by
 * clicking the company name in a previous-session row (or the ?view deep-link).
 */
export default function SessionReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const goBack = useCallback(() => navigate("/sessions"), [navigate]);

  const handleDelete = useCallback(
    async (sessionId: string) => {
      try {
        await dispatch(deleteSession(sessionId)).unwrap();
        toast.success("Session deleted.");
      } catch {
        // Active/other conflicts are resolved from the list's force-delete flow.
        toast.message("Manage this session from the sessions list.");
      } finally {
        navigate("/sessions");
      }
    },
    [dispatch, navigate],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b bg-background px-4 py-2">
        <Button variant="ghost" size="sm" onClick={goBack} className="gap-2">
          <ArrowLeft className="size-4" />
          Back to sessions
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <TranscriptDialog
          isOpen
          asPage
          sessionId={id || ""}
          onClose={goBack}
          onDelete={handleDelete}
        />
      </div>
    </div>
  );
}
