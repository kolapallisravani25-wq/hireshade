import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe, Lock } from "lucide-react";

interface Session {
  id: string;
  companyName?: string;
  jobDescription?: string;
  status?: string;
  createdAt: string;
}

interface Props {
  value: string | null;
  onChange: (sessionId: string | null) => void;
}

export function SessionPicker({ value, onChange }: Props) {
  const { getToken } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/assistant/sessions`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return;
        const data = await res.json();
        setSessions(data.data ?? []);
      } catch {
        // silently ignore
      }
    })();
  }, [getToken]);

  return (
    <Select
      value={value ?? "all"}
      onValueChange={(v) => onChange(v === "all" ? null : v)}
    >
      <SelectTrigger className="h-8 w-48 text-xs gap-1.5 border-border bg-muted/40">
        {value ? (
          <Lock className="w-3.5 h-3.5 text-brand flex-shrink-0" />
        ) : (
          <Globe className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        )}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" className="text-xs">
          All sessions
        </SelectItem>
        {sessions.map((s) => {
          const label =
            s.companyName ||
            (s.jobDescription ? s.jobDescription.slice(0, 35) + (s.jobDescription.length > 35 ? "…" : "") : null) ||
            new Date(s.createdAt).toLocaleDateString();
          return (
            <SelectItem key={s.id} value={s.id} className="text-xs">
              {label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
