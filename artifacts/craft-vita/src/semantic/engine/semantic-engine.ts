// ---------------------------------------------------------------------------
// semantic-engine.ts
// Core orchestration for the semantic marker engine
// ---------------------------------------------------------------------------

import type { SemanticClassification } from "../types/semantic.types";
import type { ContextWindowConfig } from "../types/semantic.types";
import type { ContinuationResult } from "../types/semantic.types";
import { classifyTranscriptSemantic } from "./transcript-classifier";
import { buildDynamicTranscriptWindow, extractContextFromMessages } from "./context-window-builder";
import { detectContinuationChains } from "./continuation-detector";

export interface SemanticEngineResult {
  classification: SemanticClassification;
  contextWindow: ContextWindowConfig;
  continuation: ContinuationResult;
  extractedContext: string;
}

/**
 * Main semantic engine orchestration
 * Combines classification, context windowing, and continuation detection
 */
export function semanticEngine(
  transcript: string,
  options: {
    messages?: { text: string; sender: string; timestamp: number }[];
    previousContext?: string;
    previousIntent?: string;
    lastAnswerTimestamp?: number | null;
    customWindowConfig?: Partial<ContextWindowConfig>;
  } = {},
): SemanticEngineResult {
  const {
    messages = [],
    previousContext,
    previousIntent,
    lastAnswerTimestamp = null,
    customWindowConfig,
  } = options;
  
  // Step 1: Classify transcript
  const classification = classifyTranscriptSemantic(transcript, previousContext);
  
  // Step 2: Build dynamic context window based on complexity
  const contextWindow = buildDynamicTranscriptWindow(
    classification.complexity,
    customWindowConfig,
  );
  
  // Step 3: Detect continuation if previous context exists
  const continuation = previousContext
    ? detectContinuationChains(transcript, previousContext, previousIntent as any)
    : { isContinuation: false, confidence: 0 };
  
  // Step 4: Extract context from messages if provided
  const extractedContext = messages.length > 0
    ? extractContextFromMessages(messages, contextWindow, lastAnswerTimestamp)
    : transcript;
  
  return {
    classification,
    contextWindow,
    continuation,
    extractedContext,
  };
}

/**
 * Quick classification only (no context extraction)
 */
export function quickClassify(transcript: string, previousContext?: string): SemanticClassification {
  return classifyTranscriptSemantic(transcript, previousContext);
}

/**
 * Check if transcript is scenario-based
 */
export function isScenarioBased(transcript: string): boolean {
  const classification = classifyTranscriptSemantic(transcript);
  return classification.intent === "scenario_based" || classification.intent === "system_design";
}
