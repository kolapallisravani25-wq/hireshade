import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Step7Props {
  data: {
    companyName: string;
    round?: string;
    isFree: boolean;
  };
  onCreate: () => void;
  onBack: () => void;
  loading: boolean;
}

export function Step7_Review({ data, onCreate, onBack, loading }: Step7Props) {
  const isFree = data.isFree;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 py-2 pb-0">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Ready to Create
        </h2>
        <p className="text-[14px] text-muted-foreground">
          {data.companyName}
          {data.round ? ` · ${data.round}` : ""}
        </p>
      </div>

      <div className="space-y-5">
        {isFree && (
          <div className="flex items-center gap-3">
            <span className="text-xl" role="img" aria-label="alarm-clock">
              ⏰
            </span>
            <p className="text-[15px] font-medium text-foreground">
              This is a 5 min free session.
            </p>
          </div>
        )}

        <div className="space-y-4">
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            The timer will not start until you connect your screen sharing.
          </p>

          {isFree && (
            <p className="text-[15px] text-muted-foreground leading-relaxed">
              You won't be able to create another free session for a day.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-4 pb-0">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={loading}
          className="flex-1 h-12 rounded-xl gap-2 font-bold border-border hover:bg-muted/50 transition-all shadow-sm"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onCreate}
          disabled={loading}
          className="flex-[1.5] h-12 rounded-xl bg-[#0f172a] dark:bg-white text-white dark:text-black font-bold shadow-lg hover:shadow-xl active:scale-95 transition-all text-sm"
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 border-2 border-current border-t-transparent animate-spin rounded-full" />
              Creating...
            </div>
          ) : (
            `Create ${isFree ? "Free " : ""}Session`
          )}
        </Button>
      </div>
    </div>
  );
}
