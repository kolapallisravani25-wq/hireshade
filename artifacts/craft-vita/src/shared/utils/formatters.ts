import type { CreditsBalance } from "@/hooks/useCreditsBalance";

// ─── Credit formatting ────────────────────────────────────────────────────────

export function formatCredits(raw: string | null | undefined): string {
  if (!raw) return "0";
  const n = parseFloat(raw);
  if (isNaN(n)) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

export function hasCredits(
  balance: CreditsBalance | null | undefined,
): boolean {
  if (!balance) return false;
  const total = parseFloat(balance.totalAvailable ?? "0");
  return !isNaN(total) && total > 0;
}

// ─── Date formatting ──────────────────────────────────────────────────────────

export function formatRelativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Session status ───────────────────────────────────────────────────────────

export function sessionStatusLabel(
  status: string,
): { label: string; color: string } {
  switch (status) {
    case "COMPLETED":
      return { label: "Completed", color: "text-emerald-600 bg-emerald-50" };
    case "ACTIVE":
      return { label: "Active", color: "text-blue-600 bg-blue-50" };
    case "PAUSED":
      return { label: "Paused", color: "text-amber-600 bg-amber-50" };
    case "ABANDONED":
      return { label: "Abandoned", color: "text-zinc-500 bg-zinc-100" };
    case "FORCE_ENDED":
      return { label: "Force Ended", color: "text-zinc-500 bg-zinc-100" };
    case "AUTO_ENDED":
      return { label: "Auto Ended", color: "text-zinc-500 bg-zinc-100" };
    case "CREDIT_EXHAUSTED":
      return { label: "Credits Used Up", color: "text-red-600 bg-red-50" };
    default:
      return { label: status, color: "text-zinc-500 bg-zinc-100" };
  }
}
