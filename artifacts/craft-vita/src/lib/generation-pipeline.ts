// ---------------------------------------------------------------------------
// generation-pipeline.ts
// Unified entry point for ALL AI generation flows (mic, manual, regenerate, screenshot).
// Combines the stabilizer, classifier, grouping engine, and stream guard into
// one cohesive pipeline.
// ---------------------------------------------------------------------------

import { createTranscriptStabilizer } from './transcript-stabilizer';
import {
  classifyTranscript,
  isContinuationOfPreviousQuestion,
  type ClassificationResult,
} from './semantic-classifier';
import { splitIndependentQuestions, isScenarioBasedQuestion } from './grouped-question-engine';
import {
  createGenerationGuard,
  generateSegmentId,
  isSemanticDuplicate,
} from './stream-orchestrator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GenerationMode = 'mic' | 'manual' | 'regenerate' | 'screenshot' | 'button';

export interface GenerationInput {
  transcript: string;
  mode: GenerationMode;
  sessionId: string;
  aiModel: string;
  snapshotId?: string;
  isCustomQuery?: boolean;
}

export interface GenerationDecision {
  shouldGenerate: boolean;
  groupedTranscript: string;
  segments: string[];       // segments to generate (1 for grouped, N for independent)
  segmentCount: number;
  classification: ClassificationResult;
  reason?: string;          // Why generation was deferred/blocked
}

// ---------------------------------------------------------------------------
// prepareGeneration
// ---------------------------------------------------------------------------

/**
 * Prepare a generation decision based on semantic analysis.
 * This is the MAIN entry point that should be called before any AI generation.
 * Does NOT handle stabilization timing (that's managed by the caller via createTranscriptStabilizer).
 *
 * @param input - Generation input parameters
 * @param previousContext - Previous transcript for continuation detection
 * @returns Decision on whether/how to generate
 */
export function prepareGeneration(
  input: GenerationInput,
  previousContext?: string,
): GenerationDecision {
  // --- Guard: empty transcript ---
  if (!input.transcript || input.transcript.trim().length === 0) {
    return {
      shouldGenerate: false,
      groupedTranscript: '',
      segments: [],
      segmentCount: 0,
      classification: {
        type: 'noise',
        shouldGroup: false,
        segments: [],
        confidence: 1,
      },
      reason: 'Empty transcript',
    };
  }

  // --- Bypass for regenerate mode ---
  if (input.mode === 'regenerate') {
    const bypassClassification: ClassificationResult = {
      type: 'scenario',
      shouldGroup: true,
      segments: [input.transcript],
      confidence: 1,
    };
    return {
      shouldGenerate: true,
      groupedTranscript: input.transcript,
      segments: [input.transcript],
      segmentCount: 1,
      classification: bypassClassification,
    };
  }

  // --- Bypass for screenshot mode (already preprocessed by backend) ---
  if (input.mode === 'screenshot') {
    const bypassClassification: ClassificationResult = {
      type: 'scenario',
      shouldGroup: true,
      segments: [input.transcript],
      confidence: 1,
    };
    return {
      shouldGenerate: true,
      groupedTranscript: input.transcript,
      segments: [input.transcript],
      segmentCount: 1,
      classification: bypassClassification,
    };
  }

  // --- Bypass for button mode (manual click - never block) ---
  if (input.mode === 'button') {
    const bypassClassification: ClassificationResult = {
      type: 'scenario',
      shouldGroup: true,
      segments: [input.transcript],
      confidence: 1,
    };
    return {
      shouldGenerate: true,
      groupedTranscript: input.transcript,
      segments: [input.transcript],
      segmentCount: 1,
      classification: bypassClassification,
    };
  }

  // --- mic / manual modes: full semantic analysis ---

  let transcript = input.transcript;

  // Step 1: Check continuation against previous context
  if (previousContext) {
    const timeDelta = 0; // No timestamp available; time-proximity scoring disabled
    const isContinuation = isContinuationOfPreviousQuestion(
      transcript,
      previousContext,
      timeDelta,
    );
    if (isContinuation) {
      // Merge transcripts: previous context + current
      transcript = `${previousContext} ${transcript}`;
    }
  }

  // Step 2: Run classification on (potentially merged) transcript
  const classification = classifyTranscript(transcript, previousContext);

  // If classified as noise, block generation
  if (classification.type === 'noise') {
    return {
      shouldGenerate: false,
      groupedTranscript: transcript,
      segments: classification.segments,
      segmentCount: classification.segments.length,
      classification,
      reason: 'Classified as noise',
    };
  }

  // Step 3: Determine segments based on grouping decision
  let segments: string[];

  if (classification.shouldGroup) {
    // Grouped: single segment with the full transcript
    segments = [transcript];
  } else {
    // Not grouped: attempt to split into independent questions
    segments = splitIndependentQuestions(transcript, classification);
  }

  return {
    shouldGenerate: true,
    groupedTranscript: transcript,
    segments,
    segmentCount: segments.length,
    classification,
  };
}

// ---------------------------------------------------------------------------
// shouldTriggerGeneration
// ---------------------------------------------------------------------------

/**
 * Determine if AI generation should be triggered based on multiple signals.
 * Used for AUTO-triggering only (mic/tab transcript).
 * Manual button press ALWAYS bypasses this check.
 */
export function shouldTriggerGeneration(input: {
  transcript: string;
  isStable: boolean;
  classification: ClassificationResult;
  lastGenerationTimestamp: number;
  recentQuestions: Array<{ q: string; t: number }>;
}): { trigger: boolean; reason: string } {
  // 1. Transcript must be stable (freeze window passed)
  if (!input.isStable) {
    return { trigger: false, reason: 'Transcript still stabilizing' };
  }

  // 2. At least 3 words for normal questions; allow short follow-up nudges.
  const wordCount = input.transcript.trim().split(/\s+/).filter(Boolean).length;
  const minWordThreshold =
    input.classification.type === 'follow_up' ||
    input.classification.type === 'continuation'
      ? 1
      : 3;
  if (wordCount < minWordThreshold) {
    return { trigger: false, reason: 'Transcript too short' };
  }

  // 3. Must not be noise
  if (input.classification.type === 'noise') {
    return { trigger: false, reason: 'Classified as noise' };
  }

  // 4. No exact duplicate in recentQuestions within 4000ms window
  const now = Date.now();
  const hasDuplicate = input.recentQuestions.some((rq) => {
    const timeDelta = Math.abs(now - rq.t);
    if (timeDelta > 4000) return false;
    // Exact text match within 4s window
    return rq.q.trim().toLowerCase() === input.transcript.trim().toLowerCase();
  });
  if (hasDuplicate) {
    return { trigger: false, reason: 'Duplicate within 4s window' };
  }

  // 5. Min 2s between generations
  if (now - input.lastGenerationTimestamp <= 2000) {
    return { trigger: false, reason: 'Too soon after last generation' };
  }

  return { trigger: true, reason: 'All checks passed' };
}

// ---------------------------------------------------------------------------
// Re-export utilities for convenience
// ---------------------------------------------------------------------------

export { createTranscriptStabilizer } from './transcript-stabilizer';
export { classifyTranscript, isContinuationOfPreviousQuestion } from './semantic-classifier';
export { createGenerationGuard, generateSegmentId } from './stream-orchestrator';
export type { ClassificationResult } from './semantic-classifier';
