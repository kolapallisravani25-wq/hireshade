/**
 * Targeted repair pass for low-confidence segments (G-039).
 *
 * Only segments that still contain non-high-confidence words after phonetic
 * rescue reach this pass. The provider sees the editable spans (word indexes)
 * and is allowed to suggest replacements *for those spans only*; the applier
 * mechanically rejects any suggestion that would touch a high-confidence word,
 * overlaps an already-applied edit, or renames an unverified named entity.
 *
 * The pass is budgeted at 150 ms wall clock. A slow, failed or unavailable
 * provider degrades to "rescue output unchanged" - it never blocks the answer
 * path and never invents tokens outside the vocabulary.
 *
 * Two provider implementations ship here:
 *   - createMockRepairProvider: deterministic, dependency-free, used by tests
 *     and the keyless demo.
 *   - createLlmRepairProvider: adapter over the existing LlmProvider seam
 *     (artifacts/api-server/src/lib/mocks/types.ts), used when a real model is
 *     configured. It reuses the same prompt/parse/apply contract.
 */
import type { LlmProvider } from "../../../../api-server/src/lib/mocks/types";
import {
  HIGH_CONFIDENCE_THRESHOLD,
  REPAIR_BUDGET_MS,
  isHighConfidence,
  type WordToken,
} from "./types";
import { makeWordToken } from "./text";
import type { PronunciationVocabulary } from "./vocabulary";
import { domainTermsForVariant, normalizePhrase } from "./phonemeMap";
import { phoneticKey } from "./phonetics";

export interface RepairEditableSpan {
  /** Inclusive word index. */
  start: number;
  /** Exclusive word index. */
  end: number;
  heard: string;
}

export interface RepairRequest {
  segmentId: string;
  text: string;
  /** The only word spans the provider may rewrite. */
  editableSpans: RepairEditableSpan[];
  /** Session vocabulary hints (resume/JD/company/tech terms). */
  vocabularyHints: string[];
  /** Prior interviewer/candidate turns, most recent last. */
  priorTurns: string[];
  sessionLanguage: string;
  context: {
    resumeContext?: string;
    jobDescription?: string;
  };
}

export interface RepairSuggestion {
  start: number;
  end: number;
  replacement: string;
  /** Provider confidence in [0, 1]. */
  confidence: number;
}

export interface RepairResponse {
  suggestions: RepairSuggestion[];
  providerId: string;
}

export interface RepairProvider {
  readonly id: string;
  readonly kind: "mock" | "llm";
  isConfigured(): boolean;
  repair(request: RepairRequest): Promise<RepairResponse>;
}

export interface RepairRejection {
  suggestion: RepairSuggestion;
  reason:
    | "high_confidence_protected"
    | "out_of_bounds"
    | "invalid_range"
    | "empty_replacement"
    | "overlap"
    | "named_entity_preserved"
    | "not_in_vocabulary";
}

export interface AppliedRepair {
  start: number;
  end: number;
  original: string;
  replacement: string;
  confidence: number;
}

export interface RepairPassOptions {
  /** Wall-clock budget for the provider call (default 150 ms). */
  budgetMs?: number;
  /** Injectable clock for deterministic latency assertions. */
  now?: () => number;
  vocabulary?: PronunciationVocabulary;
  priorTurns?: readonly string[];
  resumeContext?: string;
  jobDescription?: string;
  sessionLanguage?: string;
  highConfidenceThreshold?: number;
  /** Sleep used only by the timeout race; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RepairPassResult {
  words: WordToken[];
  request: RepairRequest | null;
  applied: AppliedRepair[];
  rejected: RepairRejection[];
  elapsedMs: number;
  withinBudget: boolean;
  timedOut: boolean;
  providerId: string | null;
  /** True when the segment had no low-confidence words and was never sent out. */
  skippedHighConfidence: boolean;
  error?: string;
}

const NAMED_ENTITY_STARTERS: ReadonlySet<string> = new Set([
  "the", "a", "an", "i", "we", "you", "my", "our", "it", "this", "that", "what",
  "why", "how", "when", "where", "which", "who", "can", "could", "would",
  "should", "do", "does", "did", "is", "are", "was", "were", "explain", "tell",
  "describe", "compare", "walk", "give", "show", "design", "write", "suppose",
]);

export function isLikelyNamedEntity(word: WordToken): boolean {
  const core = word.word;
  if (!core || core[0] !== core[0]?.toUpperCase()) return false;
  if (core === core.toUpperCase() && core.length > 1) return true;
  return !NAMED_ENTITY_STARTERS.has(core.toLowerCase());
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Contiguous runs of non-high-confidence words, with their heard text. */
export function editableSpansFor(
  words: readonly WordToken[],
  highConfidenceThreshold = HIGH_CONFIDENCE_THRESHOLD,
): RepairEditableSpan[] {
  const spans: RepairEditableSpan[] = [];
  let start: number | null = null;
  const flush = (end: number): void => {
    if (start === null) return;
    spans.push({
      start,
      end,
      heard: words.slice(start, end).map((word) => word.word).join(" "),
    });
    start = null;
  };
  for (let index = 0; index < words.length; index++) {
    if (words[index]!.confidence < highConfidenceThreshold) {
      if (start === null) start = index;
    } else {
      flush(index);
    }
  }
  flush(words.length);
  return spans;
}

function vocabularyHintsFor(
  words: readonly WordToken[],
  spans: readonly RepairEditableSpan[],
  vocabulary: PronunciationVocabulary | undefined,
): string[] {
  if (!vocabulary) return [];
  const hints: string[] = [];
  const editable = new Set<number>();
  for (const span of spans) {
    for (let index = span.start; index < span.end; index++) editable.add(index);
  }
  for (const word of words) {
    if (!editable.has(word.index)) continue;
    const key = phoneticKey(word.word);
    for (const entry of vocabulary.byPhonetic.get(key) ?? []) {
      if (!hints.includes(entry.canonical)) hints.push(entry.canonical);
    }
    const normalized = normalizePhrase(word.word);
    for (const entry of vocabulary.variants.get(normalized) ?? []) {
      if (!hints.includes(entry.canonical)) hints.push(entry.canonical);
    }
    for (const term of domainTermsForVariant(normalized)) {
      if (!hints.includes(term.canonical)) hints.push(term.canonical);
    }
    if (hints.length >= 12) return hints.slice(0, 12);
  }
  return hints.slice(0, 12);
}

export function buildRepairRequest(
  segmentId: string,
  words: readonly WordToken[],
  options: RepairPassOptions = {},
): RepairRequest | null {
  const spans = editableSpansFor(words, options.highConfidenceThreshold);
  if (!spans.length) return null;
  return {
    segmentId,
    text: words.map((word) => word.raw).join(" "),
    editableSpans: spans,
    vocabularyHints: vocabularyHintsFor(words, spans, options.vocabulary),
    priorTurns: [...(options.priorTurns ?? [])].slice(-2),
    sessionLanguage: options.sessionLanguage ?? "en",
    context: {
      ...(options.resumeContext ? { resumeContext: options.resumeContext } : {}),
      ...(options.jobDescription ? { jobDescription: options.jobDescription } : {}),
    },
  };
}

/** Pure prompt builder for the real LLM adapter; exported for tests. */
export function buildRepairPrompt(request: RepairRequest): string {
  const spans = request.editableSpans
    .map((span) => "- words[" + span.start + ".." + span.end + "] heard: " + JSON.stringify(span.heard))
    .join("\n");
  const hints = request.vocabularyHints.length
    ? request.vocabularyHints.join(", ")
    : "(none)";
  const prior = request.priorTurns.length ? request.priorTurns.join(" / ") : "(none)";
  const resume = request.context.resumeContext?.slice(0, 600) ?? "(none)";
  const job = request.context.jobDescription?.slice(0, 400) ?? "(none)";
  return [
    "You repair a noisy live interview transcript from a non-native English speaker.",
    "Only rewrite the words inside the editable spans below. Never change any other word.",
    "Only replace a span with a term from the candidate vocabulary. If unsure, return no suggestion for that span.",
    "Preserve person and company names exactly unless a vocabulary candidate is an exact match.",
    "Answer in " + request.sessionLanguage + " and reply with JSON only:",
    '[{"start":<int>,"end":<int>,"replacement":"<text>","confidence":<0..1>}]',
    "",
    "Transcript: " + JSON.stringify(request.text),
    "Editable spans:",
    spans,
    "Candidate vocabulary: " + hints,
    "Prior turns: " + prior,
    "Resume context: " + resume,
    "Job description: " + job,
  ].join("\n");
}

function isAllowedReplacement(value: string, request: RepairRequest): boolean {
  const normalized = normalizePhrase(value);
  if (!normalized) return false;
  for (const hint of request.vocabularyHints) {
    if (normalizePhrase(hint) === normalized) return true;
  }
  return false;
}

/** Applies provider suggestions under the hard rules. Pure and exported. */
export function applyRepairSuggestions(
  words: readonly WordToken[],
  suggestions: readonly RepairSuggestion[],
  options: {
    highConfidenceThreshold?: number;
    request?: RepairRequest;
    requireVocabularyMatch?: boolean;
  } = {},
): { words: WordToken[]; applied: AppliedRepair[]; rejected: RepairRejection[] } {
  const highThreshold = options.highConfidenceThreshold ?? HIGH_CONFIDENCE_THRESHOLD;
  const requireVocabularyMatch = options.requireVocabularyMatch ?? false;
  const rejected: RepairRejection[] = [];
  const accepted: RepairSuggestion[] = [];
  const claimed = new Set<number>();
  const allowedSet = new Set(
    (options.request?.vocabularyHints ?? []).map((hint) => normalizePhrase(hint)),
  );

  for (const suggestion of suggestions) {
    if (
      !Number.isInteger(suggestion.start) ||
      !Number.isInteger(suggestion.end) ||
      suggestion.start < 0 ||
      suggestion.end <= suggestion.start ||
      suggestion.end > words.length
    ) {
      rejected.push({ suggestion, reason: "out_of_bounds" });
      continue;
    }
    const replacement = typeof suggestion.replacement === "string" ? suggestion.replacement.trim() : "";
    if (!replacement) {
      rejected.push({ suggestion, reason: "empty_replacement" });
      continue;
    }
    let blocked = false;
    let overlaps = false;
    let namedEntityConflict = false;
    for (let index = suggestion.start; index < suggestion.end; index++) {
      const word = words[index]!;
      if (word.confidence >= highThreshold) {
        blocked = true;
        break;
      }
      if (claimed.has(index)) overlaps = true;
      if (isLikelyNamedEntity(word)) {
        const replacementKey = normalizePhrase(replacement);
        if (replacementKey !== normalizePhrase(word.word) && !allowedSet.has(replacementKey)) {
          namedEntityConflict = true;
        }
      }
    }
    if (blocked) {
      rejected.push({ suggestion, reason: "high_confidence_protected" });
      continue;
    }
    if (overlaps) {
      rejected.push({ suggestion, reason: "overlap" });
      continue;
    }
    if (requireVocabularyMatch && !isAllowedReplacement(replacement, options.request ?? {
      segmentId: "",
      text: "",
      editableSpans: [],
      vocabularyHints: [],
      priorTurns: [],
      sessionLanguage: "en",
      context: {},
    })) {
      rejected.push({ suggestion, reason: "not_in_vocabulary" });
      continue;
    }
    if (namedEntityConflict) {
      rejected.push({ suggestion, reason: "named_entity_preserved" });
      continue;
    }
    for (let index = suggestion.start; index < suggestion.end; index++) claimed.add(index);
    accepted.push({ ...suggestion, replacement });
  }

  if (!accepted.length) return { words: [...words], applied: [], rejected };

  const byStart = new Map(accepted.map((suggestion) => [suggestion.start, suggestion]));
  const out: WordToken[] = [];
  const applied: AppliedRepair[] = [];
  let index = 0;
  while (index < words.length) {
    const suggestion = byStart.get(index);
    if (!suggestion) {
      out.push({ ...words[index]!, index: out.length });
      index += 1;
      continue;
    }
    const slice = words.slice(suggestion.start, suggestion.end);
    const prefix = /^([^A-Za-z0-9]*)/.exec(slice[0]!.raw)?.[1] ?? "";
    const suffix = /([^A-Za-z0-9]*)$/.exec(slice[slice.length - 1]!.raw)?.[1] ?? "";
    const pieces = suggestion.replacement.split(/\s+/).filter(Boolean);
    applied.push({
      start: suggestion.start,
      end: suggestion.end,
      original: slice.map((word) => word.word).join(" "),
      replacement: suggestion.replacement,
      confidence: suggestion.confidence,
    });
    pieces.forEach((piece, pieceIndex) => {
      out.push(
        makeWordToken({
          index: out.length,
          raw:
            (pieceIndex === 0 ? prefix : "") +
            piece +
            (pieceIndex === pieces.length - 1 ? suffix : ""),
          confidence: 0.9,
          provenance: "repaired",
          canonical: suggestion.replacement,
        }),
      );
    });
    index = suggestion.end;
  }
  return { words: out, applied, rejected };
}

export async function repairLowConfidenceSegment(
  words: readonly WordToken[],
  provider: RepairProvider,
  options: RepairPassOptions = {},
): Promise<RepairPassResult> {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? defaultSleep;
  const budgetMs = options.budgetMs ?? REPAIR_BUDGET_MS;
  const request = buildRepairRequest("segment", words, options);
  if (!request) {
    return {
      words: [...words],
      request: null,
      applied: [],
      rejected: [],
      elapsedMs: 0,
      withinBudget: true,
      timedOut: false,
      providerId: null,
      skippedHighConfidence: true,
    };
  }

  const started = now();
  let response: RepairResponse | null = null;
  let timedOut = false;
  let error: string | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), budgetMs);
    });
    const result = await Promise.race([provider.repair(request), timeout]);
    if (result === "timeout") timedOut = true;
    else response = result;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    if (timer) clearTimeout(timer);
    await Promise.resolve();
    void sleep;
  }
  const elapsedMs = Math.max(0, Math.round((now() - started) * 100) / 100);

  if (!response || timedOut) {
    return {
      words: [...words],
      request,
      applied: [],
      rejected: [],
      elapsedMs,
      withinBudget: elapsedMs < budgetMs && !timedOut,
      timedOut,
      providerId: null,
      skippedHighConfidence: false,
      ...(error ? { error } : {}),
    };
  }

  const appliedResult = applyRepairSuggestions(words, response.suggestions, {
    highConfidenceThreshold: options.highConfidenceThreshold,
    request,
  });
  return {
    words: appliedResult.words,
    request,
    applied: appliedResult.applied,
    rejected: appliedResult.rejected,
    elapsedMs,
    withinBudget: elapsedMs < budgetMs,
    timedOut: false,
    providerId: response.providerId,
    skippedHighConfidence: false,
  };
}

/* ── Mock provider (deterministic) ───────────────────────────────────────── */

export interface MockRepairProviderOptions {
  id?: string;
  /** Simulated provider latency, for latency-budget tests (default 0). */
  simulateLatencyMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Explicit heard -> replacement overrides (case-insensitive). */
  table?: Readonly<Record<string, string>>;
}

export function createMockRepairProvider(
  options: MockRepairProviderOptions = {},
): RepairProvider {
  const simulateLatencyMs = options.simulateLatencyMs ?? 0;
  const sleep = options.sleep ?? defaultSleep;
  const table = new Map<string, string>();
  for (const [heard, replacement] of Object.entries(options.table ?? {})) {
    table.set(normalizePhrase(heard), replacement);
  }

  return {
    id: options.id ?? "mock-repair",
    kind: "mock",
    isConfigured: () => true,
    async repair(request: RepairRequest): Promise<RepairResponse> {
      const suggestions: RepairSuggestion[] = [];
      for (const span of request.editableSpans) {
        const heardTokens = span.heard.split(/\s+/).filter(Boolean);
        for (let offset = 0; offset < heardTokens.length; offset++) {
          const heard = normalizePhrase(heardTokens[offset]!);
          if (!heard) continue;
          const start = span.start + offset;
          const end = start + 1;
          const override = table.get(heard);
          if (override) {
            if (normalizePhrase(override) !== heard) {
              suggestions.push({ start, end, replacement: override, confidence: 0.95 });
            }
            continue;
          }
          const directVariants = domainTermsForVariant(heard);
          if (directVariants.length === 1) {
            const canonical = directVariants[0]!.canonical;
            if (normalizePhrase(canonical) !== heard) {
              suggestions.push({ start, end, replacement: canonical, confidence: 0.9 });
            }
            continue;
          }
          // Vocabulary-hint surface match is case-insensitive and exact.
          const hint = request.vocabularyHints.find(
            (candidate) => normalizePhrase(candidate) === heard,
          );
          if (hint && normalizePhrase(hint) !== heard) {
            suggestions.push({ start, end, replacement: hint, confidence: 0.9 });
          }
        }
      }
      if (simulateLatencyMs > 0) await sleep(simulateLatencyMs);
      return { suggestions, providerId: options.id ?? "mock-repair" };
    },
  };
}

/* ── Real provider adapter (reuses the LlmProvider seam) ─────────────────── */

/** Extracts the first JSON array from a model response (tolerates prose). */
export function parseRepairSuggestions(raw: string): RepairSuggestion[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RepairSuggestion[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const startIndex = Number(candidate["start"]);
    const endIndex = Number(candidate["end"]);
    const replacement = typeof candidate["replacement"] === "string" ? candidate["replacement"] : "";
    const confidence = Number(candidate["confidence"]);
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) continue;
    if (!replacement.trim()) continue;
    out.push({
      start: Math.trunc(startIndex),
      end: Math.trunc(endIndex),
      replacement: replacement.trim(),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7,
    });
  }
  return out;
}

export interface LlmRepairProviderOptions {
  id?: string;
  timeoutMs?: number;
}

export function createLlmRepairProvider(
  llm: LlmProvider,
  options: LlmRepairProviderOptions = {},
): RepairProvider {
  return {
    id: options.id ?? "llm-repair:" + llm.id,
    kind: "llm",
    isConfigured: () => llm.isConfigured(),
    async repair(request: RepairRequest): Promise<RepairResponse> {
      let text = "";
      await llm.stream(
        {
          messages: [
            {
              role: "system",
              content: "You are a precise transcript repair component. Reply with JSON only.",
            },
            { role: "user", content: buildRepairPrompt(request) },
          ],
          temperature: 0,
          maxTokens: 300,
        },
        (delta) => {
          text += delta;
        },
      );
      return { suggestions: parseRepairSuggestions(text), providerId: options.id ?? "llm-repair" };
    },
  };
}

/** Re-exported so callers can assert the shared budget constant. */
export { REPAIR_BUDGET_MS, phoneticKey };
