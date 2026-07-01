// ─── Section Content Renderers ────────────────────────────────────────────────
//
// Each renderer is wrapped in React.memo so re-renders are skipped when the
// parent tab switches but the section data hasn't changed (rerender-memo rule).

import React, { memo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle, ArrowRight, BarChart, ChevronDown, ChevronRight,
  CheckCircle2, Clock, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CopyBtn } from "./CopyBtn";
import type { ProjectSection, SectionType } from "./types";

// ─── Bullets ──────────────────────────────────────────────────────────────────

export const BulletsRenderer = memo(function BulletsRenderer({ content }: { content: string[] }) {
  // Defensive parse: if content arrived as a JSON string, convert it to an array.
  const bullets: string[] = Array.isArray(content)
    ? content
    : (() => {
        if (typeof content !== "string") return [];
        try { const p = JSON.parse(content); return Array.isArray(p) ? p : [content]; }
        catch { return [content]; }
      })();

  const text = bullets.join("\n");
  return (
    <div className="space-y-2">
      <div className="flex justify-end"><CopyBtn text={text} /></div>
      {bullets.map((bullet, i) => (
        <div key={i} className="flex items-start gap-3 p-3.5 rounded-lg bg-muted/40 border border-border hover:bg-accent transition-colors">
          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#458fff] shrink-0" />
          <p className="text-sm text-foreground leading-relaxed">{bullet}</p>
        </div>
      ))}
    </div>
  );
});

// ─── Narrative ────────────────────────────────────────────────────────────────

export const NarrativeRenderer = memo(function NarrativeRenderer({ content }: { content: string }) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return (
    <div className="space-y-3">
      {text.split("\n\n").filter(Boolean).map((para, i) => (
        <p key={i} className="text-sm text-muted-foreground leading-relaxed">{para}</p>
      ))}
    </div>
  );
});

// ─── How To Explain ───────────────────────────────────────────────────────────

interface HowToExplainContent {
  elevatorPitch: string;
  detailedExplanation: string;
}

export const HowToExplainRenderer = memo(function HowToExplainRenderer({
  content,
}: { content: HowToExplainContent }) {
  if (!content) return null;
  return (
    <div className="space-y-3">
      <div className="p-4 rounded-lg bg-[#458fff]/5 border border-[#458fff]/15">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[10px] font-semibold text-[#458fff] flex items-center gap-1.5 uppercase tracking-wide">
            <Clock className="h-3 w-3" /> 30-second pitch
          </span>
          <CopyBtn text={content.elevatorPitch} />
        </div>
        <blockquote className="text-sm font-medium text-foreground leading-relaxed border-l-2 border-[#458fff] pl-3 italic">
          {content.elevatorPitch}
        </blockquote>
      </div>
      <div className="p-4 rounded-lg border border-border">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[10px] font-medium text-muted-foreground">Interview deep dive · ~2 min</span>
          <CopyBtn text={content.detailedExplanation} />
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{content.detailedExplanation}</p>
      </div>
    </div>
  );
});

// ─── STAR Story ───────────────────────────────────────────────────────────────

interface StarContent {
  situation: string;
  task: string;
  action: string;
  result: string;
}

export const StarStoryRenderer = memo(function StarStoryRenderer({ content }: { content: StarContent }) {
  if (!content) return null;
  const fullText = `SITUATION\n${content.situation}\n\nTASK\n${content.task}\n\nACTION\n${content.action}\n\nRESULT\n${content.result}`;
  const parts = [
    { label: "Situation", leftBorder: "border-l-blue-400",    value: content.situation },
    { label: "Task",      leftBorder: "border-l-violet-400",  value: content.task },
    { label: "Action",   leftBorder: "border-l-amber-400",   value: content.action },
    { label: "Result",   leftBorder: "border-l-emerald-400", value: content.result },
  ];
  return (
    <div className="space-y-2">
      <div className="flex justify-end"><CopyBtn text={fullText} /></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {parts.map((part) => (
          <div key={part.label} className={cn("p-4 rounded-lg border border-border border-l-2 bg-muted/30", part.leftBorder)}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{part.label}</p>
            <p className="text-sm text-foreground leading-relaxed">{part.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── 30-Second Summary ────────────────────────────────────────────────────────

interface ThirtySecContent {
  hook: string;
  mainPoints: string[];
  closingLine: string;
}

export const ThirtySecondSummaryRenderer = memo(function ThirtySecondSummaryRenderer({
  content,
}: { content: ThirtySecContent }) {
  if (!content) return null;
  return (
    <div className="rounded-xl border border-[#458fff]/20 bg-[#458fff]/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-[#458fff]/15 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer className="h-3.5 w-3.5 text-[#458fff]" />
          <span className="text-[10px] font-semibold text-[#458fff] uppercase tracking-widest">30-Second Pitch</span>
        </div>
        <CopyBtn text={`${content.hook}\n\n${(content.mainPoints || []).join("\n")}\n\n${content.closingLine}`} />
      </div>
      <div className="px-4 pt-4 pb-3">
        <p className="text-sm font-semibold text-foreground leading-relaxed mb-3 border-l-2 border-[#458fff] pl-3">
          {content.hook}
        </p>
        <ol className="space-y-1.5 mb-3 ml-3">
          {(content.mainPoints || []).map((pt, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="h-4 w-4 rounded-full bg-[#458fff]/10 text-[#458fff] text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <span>{pt}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs font-medium text-[#458fff] italic pl-3">{content.closingLine}</p>
      </div>
    </div>
  );
});

// ─── Architecture Tree ────────────────────────────────────────────────────────

interface ArchTreeNode {
  name: string;
  description: string;
  tech: string;
  children?: Array<{ name: string; description: string }>;
}

interface ArchTreeLayer {
  name: string;
  nodes: ArchTreeNode[];
}

const LAYER_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  Frontend:       { bg: "bg-violet-50 dark:bg-violet-950/30", border: "border-violet-200 dark:border-violet-800", text: "text-violet-700 dark:text-violet-300", badge: "bg-violet-100 text-violet-700 border-violet-200" },
  Backend:        { bg: "bg-blue-50 dark:bg-blue-950/30",     border: "border-blue-200 dark:border-blue-800",     text: "text-blue-700 dark:text-blue-300",     badge: "bg-blue-100 text-blue-700 border-blue-200" },
  Database:       { bg: "bg-amber-50 dark:bg-amber-950/30",   border: "border-amber-200 dark:border-amber-800",   text: "text-amber-700 dark:text-amber-300",   badge: "bg-amber-100 text-amber-700 border-amber-200" },
  Infrastructure: { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", text: "text-emerald-700 dark:text-emerald-300", badge: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

// Not memoized — has internal open/close state driven by user interaction
function ArchTreeNodeCard({ node, colors }: { node: ArchTreeNode; colors: typeof LAYER_COLORS[string] }) {
  const [open, setOpen] = useState(false);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  return (
    <div className={cn("rounded-lg border transition-all", colors.border, open ? colors.bg : "bg-background hover:bg-muted/30")}>
      <button
        onClick={() => hasChildren && setOpen((v) => !v)}
        className={cn("w-full flex items-start gap-3 px-3.5 py-3 text-left", hasChildren ? "cursor-pointer" : "cursor-default")}
      >
        {hasChildren && (
          <div className="mt-0.5 shrink-0">
            {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        )}
        {!hasChildren && <div className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{node.name}</span>
            {node.tech && (
              <Badge variant="outline" className={cn("text-[9px] font-mono shrink-0", colors.badge)}>{node.tech}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{node.description}</p>
        </div>
      </button>
      {open && hasChildren && (
        <div className="px-3.5 pb-3 ml-6 space-y-1.5 border-t border-inherit pt-2.5">
          {node.children!.map((child, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-md bg-background border border-border">
              <ArrowRight className="h-3 w-3 text-muted-foreground/50 mt-0.5 shrink-0" />
              <div>
                <span className="text-xs font-medium text-foreground">{child.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{child.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const ArchitectureTreeRenderer = memo(function ArchitectureTreeRenderer({
  content,
}: { content: { layers: ArchTreeLayer[] } }) {
  const [expandedLayers, setExpandedLayers] = useState<Record<string, boolean>>({});
  const toggle = (name: string) => setExpandedLayers((p) => ({ ...p, [name]: !p[name] }));

  if (!content?.layers?.length) return null;

  return (
    <div className="space-y-3">
      <div className="hidden sm:flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
        {content.layers.map((layer, i) => {
          const c = LAYER_COLORS[layer.name] ?? LAYER_COLORS.Backend;
          return (
            <React.Fragment key={layer.name}>
              <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold shrink-0 whitespace-nowrap", c.bg, c.border, c.text)}>
                {layer.name}
                <span className="text-[10px] opacity-60">({layer.nodes.length})</span>
              </div>
              {i < content.layers.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
            </React.Fragment>
          );
        })}
      </div>
      {content.layers.map((layer) => {
        const c = LAYER_COLORS[layer.name] ?? LAYER_COLORS.Backend;
        const isOpen = expandedLayers[layer.name] !== false;
        return (
          <div key={layer.name} className={cn("rounded-xl border overflow-hidden", c.border)}>
            <button
              onClick={() => toggle(layer.name)}
              className={cn("w-full flex items-center justify-between px-4 py-3 border-b", c.bg, c.border)}
            >
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-bold uppercase tracking-wider", c.text)}>{layer.name}</span>
                <Badge variant="outline" className={cn("text-[9px]", c.badge)}>{layer.nodes.length} nodes</Badge>
              </div>
              {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {isOpen && (
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-background">
                {layer.nodes.map((node, i) => (
                  <ArchTreeNodeCard key={i} node={node} colors={c} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const MetadataRenderer = memo(function MetadataRenderer({
  content,
}: { content: { fields: Array<{ label: string; value: string }> } }) {
  if (!content?.fields) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {content.fields.map((f, i) => (
        <div key={i} className="px-3.5 py-2 rounded-lg border border-border bg-muted/40">
          <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider leading-none">{f.label}</p>
          <p className="text-xs font-semibold text-foreground leading-none mt-1">{f.value}</p>
        </div>
      ))}
    </div>
  );
});

// ─── Code Block ───────────────────────────────────────────────────────────────

export const CodeBlockRenderer = memo(function CodeBlockRenderer({ content }: { content: string }) {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return (
    <div className="rounded-xl bg-zinc-950 overflow-hidden border border-zinc-800">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-800">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
        </div>
        <CopyBtn text={text} className="border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500" />
      </div>
      <pre className="px-5 py-4 text-sm font-mono leading-relaxed text-emerald-400 overflow-x-auto whitespace-pre">
        <code>{text}</code>
      </pre>
    </div>
  );
});

// ─── Tech Tags ────────────────────────────────────────────────────────────────

export const TechTagsRenderer = memo(function TechTagsRenderer({
  content,
}: { content: Array<{ category: string; tags: string[] }> }) {
  if (!Array.isArray(content)) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {content.map((group, i) => (
        <div key={i} className="p-4 rounded-lg border border-border">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">{group.category}</p>
          <div className="flex flex-wrap gap-1.5">
            {Array.isArray(group.tags) && group.tags.map((tag, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs font-medium">{tag}</Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

// ─── Steps ────────────────────────────────────────────────────────────────────

export const StepsRenderer = memo(function StepsRenderer({
  content,
}: { content: Array<{ step: string; description: string }> }) {
  if (!Array.isArray(content)) return null;
  return (
    <div className="space-y-2">
      {content.map((item, i) => (
        <div key={i} className="flex items-start gap-3 p-3.5 rounded-lg border border-border hover:bg-accent/50 transition-colors">
          <div className="h-6 w-6 rounded-md bg-[#458fff]/10 text-[#458fff] flex items-center justify-center shrink-0 text-[11px] font-bold tabular-nums mt-0.5">
            {i + 1}
          </div>
          <div className="min-w-0">
            <h5 className="text-sm font-medium text-foreground leading-tight">{item.step}</h5>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
});

// ─── Challenge Cards ──────────────────────────────────────────────────────────

export const ChallengeCardsRenderer = memo(function ChallengeCardsRenderer({
  content,
}: { content: Array<{ challenge: string; solution: string }> }) {
  if (!Array.isArray(content)) return null;
  return (
    <div className="space-y-3">
      {content.map((item, i) => (
        <div key={i} className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 bg-red-50/60 border-b border-border">
            <div className="flex items-center gap-2 text-red-500 mb-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wide">Challenge</span>
            </div>
            <p className="text-sm font-medium text-foreground">{item.challenge}</p>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-emerald-600 mb-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wide">Resolution</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{item.solution}</p>
          </div>
        </div>
      ))}
    </div>
  );
});

// ─── Metrics ──────────────────────────────────────────────────────────────────

interface MetricItem {
  metric: string;
  value: string;
  description: string;
  before?: string;
  after?: string;
}

export const MetricsRenderer = memo(function MetricsRenderer({ content }: { content: MetricItem[] }) {
  if (!Array.isArray(content)) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      {content.map((item, i) => (
        <div key={i} className="p-4 rounded-lg border border-border bg-background">
          <p className="text-2xl font-bold text-[#458fff] tabular-nums leading-none">{item.value}</p>
          <p className="text-xs font-semibold text-foreground mt-1.5 leading-snug">{item.metric}</p>
          {item.description && <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{item.description}</p>}
          {(item.before || item.after) && (
            <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
              {item.before && <span className="font-mono line-through">{item.before}</span>}
              {item.before && item.after && <ArrowRight className="h-3 w-3" />}
              {item.after && <span className="font-mono text-emerald-600 font-medium">{item.after}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

// ─── Quote Cards ──────────────────────────────────────────────────────────────

export const QuoteCardsRenderer = memo(function QuoteCardsRenderer({ content }: { content: string[] }) {
  if (!Array.isArray(content)) return null;
  return (
    <div className="space-y-2.5">
      {content.map((quote, i) => (
        <div key={i} className="flex items-start gap-3 p-4 rounded-lg border border-border bg-muted/30">
          <span className="text-3xl leading-none text-[#458fff]/40 font-serif mt-0.5">&ldquo;</span>
          <p className="text-sm text-foreground leading-relaxed italic">{quote}</p>
        </div>
      ))}
    </div>
  );
});

// ─── Key Value Pairs ──────────────────────────────────────────────────────────

export const KeyValueRenderer = memo(function KeyValueRenderer({
  content,
}: { content: Array<{ key: string; value: string }> }) {
  if (!Array.isArray(content)) return null;
  return (
    <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
      {content.map((item, i) => (
        <div key={i} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-4 py-3 even:bg-muted/30">
          <dt className="text-[11px] font-semibold text-muted-foreground sm:w-32 sm:shrink-0 sm:pt-0.5 capitalize">{item.key}</dt>
          <dd className="text-sm text-foreground leading-relaxed min-w-0">{item.value}</dd>
        </div>
      ))}
    </div>
  );
});

// ─── Comparison Table ─────────────────────────────────────────────────────────

export const ComparisonTableRenderer = memo(function ComparisonTableRenderer({
  content,
}: { content: Array<{ decision: string; winner: string; loser: string; rationale: string }> }) {
  if (!Array.isArray(content)) return null;
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {["Decision", "Chosen", "Alternative", "Rationale"].map((h) => (
              <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {content.map((row, i) => (
            <tr key={i} className="hover:bg-accent/50 transition-colors">
              <td className="px-3.5 py-3 text-xs font-medium text-foreground">{row.decision}</td>
              <td className="px-3.5 py-3">
                <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">{row.winner}</Badge>
              </td>
              <td className="px-3.5 py-3">
                <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">{row.loser}</Badge>
              </td>
              <td className="px-3.5 py-3 text-xs text-muted-foreground max-w-xs">{row.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

// ─── Cards ────────────────────────────────────────────────────────────────────

export const CardsRenderer = memo(function CardsRenderer({
  content,
}: { content: Array<{ title: string; body: string; badge?: string }> }) {
  if (!Array.isArray(content)) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {content.map((card, i) => (
        <div key={i} className="p-4 rounded-lg border border-border hover:border-[#458fff]/30 transition-colors">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h5 className="text-sm font-semibold text-foreground leading-snug">{card.title}</h5>
            {card.badge && <Badge variant="outline" className="text-[9px] shrink-0 font-medium">{card.badge}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{card.body}</p>
        </div>
      ))}
    </div>
  );
});

// ─── Table ────────────────────────────────────────────────────────────────────

export const TableRenderer = memo(function TableRenderer({
  content,
}: { content: { headers: string[]; rows: string[][] } }) {
  if (!content?.headers?.length) return null;
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {content.headers.map((h, i) => (
                <th key={i} className="px-3.5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(content.rows || []).map((row, i) => (
              <tr key={i} className="hover:bg-accent/50 transition-colors">
                {row.map((cell, j) => (
                  <td key={j} className={cn("px-3.5 py-3 text-xs leading-relaxed", j === 0 ? "font-medium text-foreground" : "text-muted-foreground")}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

// ─── Timeline ─────────────────────────────────────────────────────────────────

export const TimelineRenderer = memo(function TimelineRenderer({
  content,
}: { content: Array<{ date: string; event: string; description: string }> }) {
  if (!Array.isArray(content)) return null;
  return (
    <div className="relative space-y-3 pl-5 border-l border-border">
      {content.map((item, i) => (
        <div key={i} className="relative">
          <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#458fff] bg-background" />
          <div className="p-3.5 rounded-lg border border-border hover:bg-accent/50 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold text-[#458fff]">{item.date}</span>
            </div>
            <h5 className="text-sm font-medium text-foreground leading-tight">{item.event}</h5>
            {item.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>}
          </div>
        </div>
      ))}
    </div>
  );
});

// ─── Code Snippets ────────────────────────────────────────────────────────────

export const CodeSnippetsRenderer = memo(function CodeSnippetsRenderer({
  content,
}: { content: Array<{ title: string; language: string; purpose: string; code: string }> }) {
  if (!Array.isArray(content)) return null;
  return (
    <div className="space-y-4">
      {content.map((snippet, i) => (
        <div key={i} className="rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
          <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-800">
            <div className="flex items-center gap-2.5">
              <div className="flex gap-1">
                <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
              </div>
              <span className="text-xs font-medium text-zinc-300">{snippet.title}</span>
              <Badge className="text-[9px] font-mono bg-zinc-800 text-zinc-400 border-zinc-700">{snippet.language}</Badge>
            </div>
            <CopyBtn text={snippet.code} className="border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500" />
          </div>
          {snippet.purpose && (
            <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
              <p className="text-[11px] text-zinc-400">{snippet.purpose}</p>
            </div>
          )}
          <pre className="px-5 py-4 text-sm font-mono leading-relaxed text-emerald-400 overflow-x-auto whitespace-pre">
            <code>{snippet.code}</code>
          </pre>
        </div>
      ))}
    </div>
  );
});

// ─── Fallback ─────────────────────────────────────────────────────────────────

export const FallbackRenderer = memo(function FallbackRenderer({ content }: { content: unknown }) {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return (
    <div className="p-4 rounded-lg bg-muted/40 border border-border">
      <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">{text}</pre>
    </div>
  );
});

// ─── Master Section Renderer ──────────────────────────────────────────────────

export function SectionRenderer({ section }: { section: ProjectSection }) {
  switch (section.type) {
    case "bullets":               return <BulletsRenderer content={section.content} />;
    case "narrative":             return <NarrativeRenderer content={section.content} />;
    case "how_to_explain":        return <HowToExplainRenderer content={section.content} />;
    case "star_story":            return <StarStoryRenderer content={section.content} />;
    case "thirty_second_summary": return <ThirtySecondSummaryRenderer content={section.content} />;
    case "architecture_tree":     return <ArchitectureTreeRenderer content={section.content} />;
    case "metadata":              return <MetadataRenderer content={section.content} />;
    case "code_block":            return <CodeBlockRenderer content={section.content} />;
    case "tech_tags":             return <TechTagsRenderer content={section.content} />;
    case "steps":                 return <StepsRenderer content={section.content} />;
    case "challenge_cards":       return <ChallengeCardsRenderer content={section.content} />;
    case "metrics":               return <MetricsRenderer content={section.content} />;
    case "quote_cards":           return <QuoteCardsRenderer content={section.content} />;
    case "key_value_pairs":       return <KeyValueRenderer content={section.content} />;
    case "comparison_table":      return <ComparisonTableRenderer content={section.content} />;
    case "cards":                 return <CardsRenderer content={section.content} />;
    case "table":                 return <TableRenderer content={section.content} />;
    case "timeline":              return <TimelineRenderer content={section.content} />;
    case "code_snippets":         return <CodeSnippetsRenderer content={section.content} />;
    default:                      return <FallbackRenderer content={section.content} />;
  }
}

// Re-export SectionType for convenience
export type { SectionType };
