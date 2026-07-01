export interface OpenRouterActivityItem {
  date: string;
  model: string;
  model_permaslug: string;
  endpoint_id: string;
  provider_name: string;
  usage: number;
  byok_usage_inference: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
}

export interface OpenRouterActivityResponse {
  data: OpenRouterActivityItem[];
}

export interface OpenRouterModelItem {
  id: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
}

export interface OpenRouterKeyItem {
  hash: string;
  name: string;
  label: string;
  disabled: boolean;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: string | null;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  byok_usage: number;
  byok_usage_daily: number;
  byok_usage_weekly: number;
  byok_usage_monthly: number;
  include_byok_in_limit: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  workspace_id: string | null;
  creator_user_id: string | null;
}

export interface OpenRouterKeysResponse {
  data: OpenRouterKeyItem[];
}

export interface ModelUsageSummary {
  model: string;
  provider: string;
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  totalCost: number;
  byokCost: number;
  contextLength?: number;
  promptCost?: number;
  completionCost?: number;
}

export interface DailyUsageSummary {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  totalCost: number;
  models: number;
}

export interface ProviderSummary {
  provider: string;
  requests: number;
  totalTokens: number;
  totalCost: number;
  models: string[];
}

export interface APIAnalyticsSummary {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  totalCost: number;
  totalByokCost: number;
  uniqueModels: number;
  uniqueProviders: number;
  activeKeys: number;
  totalKeys: number;
  avgCostPerRequest: number;
  dailyUsage: DailyUsageSummary[];
  modelUsage: ModelUsageSummary[];
  providerUsage: ProviderSummary[];
  keys: OpenRouterKeyItem[];
  accountTotalCredits: number;
  accountTotalUsage: number;
}
