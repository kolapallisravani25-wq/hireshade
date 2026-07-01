// ── Stream Orchestration Guard ────────────────────────────────────────────────
// Prevents duplicate stream cards and manages generation locking to ensure
// grouped scenarios produce only ONE card.

const STALE_GENERATION_MS = 60_000; // 60 seconds
const DEFAULT_DUPLICATE_THRESHOLD = 0.8;

// ── Normalization helpers ─────────────────────────────────────────────────────

/** Lowercase, trim, collapse whitespace, strip punctuation. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

/** Split normalized text into a Set of word tokens. */
function tokenize(normalized: string): Set<string> {
  const tokens = normalized.split(" ").filter(Boolean);
  return new Set(tokens);
}

/** djb2 hash — fast, non-crypto, good enough for segment IDs. */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(36);
}

// ── Generation Guard ──────────────────────────────────────────────────────────

export interface GenerationGuard {
  /** Check if generation can start for this segment. Returns false if already active or duplicate. */
  canStartGeneration(segmentId: string, transcript?: string): boolean;
  /** Lock generation for a segment ID. */
  lockGeneration(segmentId: string, transcript?: string): void;
  /** Release generation lock for a segment ID. */
  releaseGeneration(segmentId: string): void;
  /** Whether ANY generation is currently active. */
  isGenerationActive(): boolean;
  /** Get the currently active segment ID (null if none). */
  getActiveSegmentId(): string | null;
  /** Get all active segment IDs. */
  getActiveSegmentIds(): string[];
  /** Reset all locks (e.g., on session end or error recovery). */
  reset(): void;
}

interface ActiveGeneration {
  startedAt: number;
  transcript: string;
}

/** Evict stale entries that have exceeded the 60-second auto-expiry. */
function evictStale(activeGenerations: Map<string, ActiveGeneration>): void {
  const now = Date.now();
  for (const [key, entry] of activeGenerations) {
    if (now - entry.startedAt > STALE_GENERATION_MS) {
      activeGenerations.delete(key);
    }
  }
}

/**
 * Create a generation guard instance.
 * Manages concurrent generation locks to prevent duplicate cards.
 */
export function createGenerationGuard(): GenerationGuard {
  const activeGenerations = new Map<string, ActiveGeneration>();

  return {
    canStartGeneration(segmentId: string, transcript?: string): boolean {
      evictStale(activeGenerations);

      // Duplicate segment ID check
      if (activeGenerations.has(segmentId)) {
        return false;
      }

      // Semantic duplicate check against all active transcripts
      if (transcript) {
        for (const entry of activeGenerations.values()) {
          if (entry.transcript && isSemanticDuplicate(transcript, entry.transcript)) {
            return false;
          }
        }
      }

      return true;
    },

    lockGeneration(segmentId: string, transcript?: string): void {
      activeGenerations.set(segmentId, {
        startedAt: Date.now(),
        transcript: transcript ?? "",
      });
    },

    releaseGeneration(segmentId: string): void {
      activeGenerations.delete(segmentId);
    },

    isGenerationActive(): boolean {
      evictStale(activeGenerations);
      return activeGenerations.size > 0;
    },

    getActiveSegmentId(): string | null {
      evictStale(activeGenerations);
      const firstKey = activeGenerations.keys().next();
      return firstKey.done ? null : firstKey.value;
    },

    getActiveSegmentIds(): string[] {
      evictStale(activeGenerations);
      return Array.from(activeGenerations.keys());
    },

    reset(): void {
      activeGenerations.clear();
    },
  };
}

// ── Segment ID generation ─────────────────────────────────────────────────────

/**
 * Generate a unique segment ID for a transcript.
 * Uses normalized content hash to detect semantic duplicates.
 */
export function generateSegmentId(transcript: string): string {
  const normalized = normalize(transcript);
  const head = normalized.slice(0, 100);
  const hash = djb2Hash(head);
  return `seg_${hash}`;
}

// ── Semantic duplicate detection ──────────────────────────────────────────────

/**
 * Check if two transcripts are semantically similar enough to be considered duplicates.
 * Uses normalized token overlap scoring (Jaccard similarity).
 */
export function isSemanticDuplicate(
  transcript1: string,
  transcript2: string,
  threshold: number = DEFAULT_DUPLICATE_THRESHOLD,
): boolean {
  const tokens1 = tokenize(normalize(transcript1));
  const tokens2 = tokenize(normalize(transcript2));

  if (tokens1.size === 0 && tokens2.size === 0) return true;
  if (tokens1.size === 0 || tokens2.size === 0) return false;

  let intersectionSize = 0;
  for (const token of tokens1) {
    if (tokens2.has(token)) {
      intersectionSize++;
    }
  }

  const unionSize = tokens1.size + tokens2.size - intersectionSize;
  if (unionSize === 0) return true;

  const similarity = intersectionSize / unionSize;
  return similarity >= threshold;
}
