// ---------------------------------------------------------------------------
// context-window-builder.ts
// Dynamic transcript context window sizing
// ---------------------------------------------------------------------------

import type { ContextWindowConfig, TranscriptComplexity } from "../types/semantic.types";

/**
 * Default context window configurations by complexity
 */
const DEFAULT_WINDOWS: Record<TranscriptComplexity, ContextWindowConfig> = {
  minimal: {
    messageCount: 5,
    timeWindowMs: 5000,
    expandForScenario: false,
    preserveNarrativeChains: false,
  },
  standard: {
    messageCount: 12,
    timeWindowMs: 10000,
    expandForScenario: false,
    preserveNarrativeChains: false,
  },
  extended: {
    messageCount: 20,
    timeWindowMs: 30000,
    expandForScenario: true,
    preserveNarrativeChains: true,
  },
  scenario: {
    messageCount: 30,
    timeWindowMs: 60000,
    expandForScenario: true,
    preserveNarrativeChains: true,
  },
  architecture: {
    messageCount: 40,
    timeWindowMs: 120000,
    expandForScenario: true,
    preserveNarrativeChains: true,
  },
};

/**
 * Build dynamic transcript context window based on complexity
 */
export function buildDynamicTranscriptWindow(
  complexity: TranscriptComplexity,
  customConfig?: Partial<ContextWindowConfig>,
): ContextWindowConfig {
  const baseConfig = DEFAULT_WINDOWS[complexity];
  
  return {
    ...baseConfig,
    ...customConfig,
  };
}

/**
 * Extract context from messages based on window configuration
 */
export function extractContextFromMessages(
  allMessages: { text: string; sender: string; timestamp: number }[],
  config: ContextWindowConfig,
  lastAnswerTimestamp: number | null,
): string {
  // Guard against empty messages array
  if (allMessages.length === 0) {
    return "";
  }

  // Determine cutoff based on config and last answer timestamp
  const cutoff = lastAnswerTimestamp !== null
    ? Math.min(lastAnswerTimestamp, Date.now() - config.timeWindowMs)
    : Date.now() - config.timeWindowMs;

  // Filter messages based on cutoff and window size
  let contextMessages = allMessages.filter(
    (m) => m.timestamp > cutoff && m.text?.trim()
  );

  // If preserveNarrativeChains is enabled, look backward for narrative context
  if (config.preserveNarrativeChains && contextMessages.length > 0 && contextMessages.length < config.messageCount) {
    const needed = config.messageCount - contextMessages.length;
    const sender = contextMessages[0]?.sender;
    
    // Guard against undefined sender
    if (!sender) {
      // Fallback: just use the last config.messageCount messages
      contextMessages = allMessages.slice(-config.messageCount);
    } else {
      const allSenderMessages = allMessages.filter(
        m => m.sender === sender
      );
      
      // Look back up to needed messages, but don't exceed array bounds
      const startIndex = Math.max(0, allSenderMessages.length - contextMessages.length - needed);
      const endIndex = allSenderMessages.length - contextMessages.length;
      
      // Guard against invalid slice range
      if (startIndex < endIndex) {
        const additionalMessages = allSenderMessages.slice(startIndex, endIndex);
        
        // Only add if they're within time window
        const validAdditional = additionalMessages.filter(
          m => m.timestamp >= cutoff - config.timeWindowMs
        );
        
        contextMessages = [...validAdditional, ...contextMessages];
      }
    }
  }

  // Limit to message count
  if (contextMessages.length > config.messageCount) {
    contextMessages = contextMessages.slice(-config.messageCount);
  }

  // Join messages
  return contextMessages.map(m => m.text.trim()).join(" ");
}
