// ---------------------------------------------------------------------------
// segmentation.rules.ts
// Configurable rules for transcript segmentation
// ---------------------------------------------------------------------------

import type { SemanticIntent } from "../types/semantic.types";

export interface SegmentationRules {
  shouldSplit: boolean;
  splitPattern?: string | RegExp;
  minSegmentLength: number;
  maxSegments: number;
}

/**
 * Segmentation rules by intent
 * Determines if transcript should be split into multiple questions
 */
export const SEGMENTATION_RULES: Record<SemanticIntent, SegmentationRules> = {
  simple_question: {
    shouldSplit: false,
    minSegmentLength: 5,
    maxSegments: 1,
  },
  scenario_based: {
    shouldSplit: false,
    minSegmentLength: 20,
    maxSegments: 1,
  },
  system_design: {
    shouldSplit: false,
    minSegmentLength: 30,
    maxSegments: 1,
  },
  behavioral_star: {
    shouldSplit: false,
    minSegmentLength: 20,
    maxSegments: 1,
  },
  frontend: {
    shouldSplit: true,
    splitPattern: /[?!.]/,
    minSegmentLength: 5,
    maxSegments: 3,
  },
  backend: {
    shouldSplit: true,
    splitPattern: /[?!.]/,
    minSegmentLength: 5,
    maxSegments: 3,
  },
  database: {
    shouldSplit: true,
    splitPattern: /[?!.]/,
    minSegmentLength: 5,
    maxSegments: 3,
  },
  scaling: {
    shouldSplit: false,
    minSegmentLength: 20,
    maxSegments: 1,
  },
  debugging: {
    shouldSplit: true,
    splitPattern: /[?!.]/,
    minSegmentLength: 5,
    maxSegments: 2,
  },
  deployment: {
    shouldSplit: true,
    splitPattern: /[?!.]/,
    minSegmentLength: 5,
    maxSegments: 2,
  },
  ai_architecture: {
    shouldSplit: false,
    minSegmentLength: 20,
    maxSegments: 1,
  },
  continuation: {
    shouldSplit: false,
    minSegmentLength: 5,
    maxSegments: 1,
  },
  noise: {
    shouldSplit: false,
    minSegmentLength: 0,
    maxSegments: 1,
  },
  filler: {
    shouldSplit: false,
    minSegmentLength: 0,
    maxSegments: 1,
  },
  independent_questions: {
    shouldSplit: true,
    splitPattern: /[?!.]/,
    minSegmentLength: 5,
    maxSegments: 5,
  },
};

/**
 * Get segmentation rules for a specific intent
 */
export function getSegmentationRules(intent: SemanticIntent): SegmentationRules {
  return SEGMENTATION_RULES[intent] || SEGMENTATION_RULES.simple_question;
}
