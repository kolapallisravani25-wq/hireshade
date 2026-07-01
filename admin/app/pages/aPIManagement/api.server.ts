import { app } from '../../_server/app.js';
import {
  OpenRouterActivityItem,
  OpenRouterKeyItem,
  OpenRouterModelItem,
  APIAnalyticsSummary,
  ModelUsageSummary,
  DailyUsageSummary,
  ProviderSummary,
} from '../../types';
import dotenv from 'dotenv';

dotenv.config();

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function getManagementKey(): string {
  const key = process.env.OPEN_ROUTER_MANAGEMENT_KEY;
  if (!key) throw new Error('OPEN_ROUTER_MANAGEMENT_KEY is not configured');
  return key;
}

async function orFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${OPENROUTER_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${getManagementKey()}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${path} returned ${res.status}: ${body.substring(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

function aggregateByModel(items: OpenRouterActivityItem[], models: OpenRouterModelItem[]): ModelUsageSummary[] {
  const map = new Map<string, ModelUsageSummary>();
  const modelsMap = new Map(models.map(m => [m.id, m]));

  for (const item of items) {
    const existing = map.get(item.model);
    if (existing) {
      existing.totalRequests += item.requests;
      existing.promptTokens += item.prompt_tokens;
      existing.completionTokens += item.completion_tokens;
      existing.reasoningTokens += item.reasoning_tokens;
      existing.totalTokens += item.prompt_tokens + item.completion_tokens + item.reasoning_tokens;
      existing.totalCost += item.usage;
      existing.byokCost += item.byok_usage_inference;
    } else {
      const modelInfo = modelsMap.get(item.model);
      map.set(item.model, {
        model: item.model,
        provider: item.provider_name,
        totalRequests: item.requests,
        promptTokens: item.prompt_tokens,
        completionTokens: item.completion_tokens,
        reasoningTokens: item.reasoning_tokens,
        totalTokens: item.prompt_tokens + item.completion_tokens + item.reasoning_tokens,
        totalCost: item.usage,
        byokCost: item.byok_usage_inference,
        contextLength: modelInfo?.context_length,
        promptCost: modelInfo?.pricing?.prompt ? parseFloat(modelInfo.pricing.prompt) : undefined,
        completionCost: modelInfo?.pricing?.completion ? parseFloat(modelInfo.pricing.completion) : undefined,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
}

function aggregateByDay(items: OpenRouterActivityItem[]): DailyUsageSummary[] {
  const map = new Map<string, DailyUsageSummary>();

  for (const item of items) {
    const existing = map.get(item.date);
    if (existing) {
      existing.requests += item.requests;
      existing.promptTokens += item.prompt_tokens;
      existing.completionTokens += item.completion_tokens;
      existing.reasoningTokens += item.reasoning_tokens;
      existing.totalTokens += item.prompt_tokens + item.completion_tokens + item.reasoning_tokens;
      existing.totalCost += item.usage;
      existing.models += 1;
    } else {
      map.set(item.date, {
        date: item.date,
        requests: item.requests,
        promptTokens: item.prompt_tokens,
        completionTokens: item.completion_tokens,
        reasoningTokens: item.reasoning_tokens,
        totalTokens: item.prompt_tokens + item.completion_tokens + item.reasoning_tokens,
        totalCost: item.usage,
        models: 1,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateByProvider(items: OpenRouterActivityItem[]): ProviderSummary[] {
  const map = new Map<string, ProviderSummary>();

  for (const item of items) {
    const existing = map.get(item.provider_name);
    if (existing) {
      existing.requests += item.requests;
      existing.totalTokens += item.prompt_tokens + item.completion_tokens + item.reasoning_tokens;
      existing.totalCost += item.usage;
      if (!existing.models.includes(item.model)) {
        existing.models.push(item.model);
      }
    } else {
      map.set(item.provider_name, {
        provider: item.provider_name,
        requests: item.requests,
        totalTokens: item.prompt_tokens + item.completion_tokens + item.reasoning_tokens,
        totalCost: item.usage,
        models: [item.model],
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
}

const controller = app.defineCustomController({

  getAPIAnalytics: async (input: any, _ctx: any): Promise<APIAnalyticsSummary> => {
    try {
      const filterDate = typeof input === 'string' ? input : input?.filterDate;

      const keysRes = await orFetch<{ data: OpenRouterKeyItem[] }>('/keys', { include_disabled: 'false' });
      const keys = keysRes.data || [];

      const ScribeShadeKey = keys.find(k =>
        (k.name || '').toLowerCase().includes('ScribeShade') ||
        (k.label || '').toLowerCase().includes('ScribeShade')
      );

      const activityParams: Record<string, string> = {};
      if (filterDate) {
        activityParams.date = filterDate;
      }
      if (ScribeShadeKey) {
        activityParams.api_key_hash = ScribeShadeKey.hash;
      }

      const [activityRes, modelsRes, creditsRes] = await Promise.all([
        orFetch<{ data: OpenRouterActivityItem[] }>('/activity', activityParams),
        orFetch<{ data: OpenRouterModelItem[] }>('/models'),
        orFetch<{ data: { total_credits: number; total_usage: number } }>('/credits'),
      ]);
      
      const activityItems = activityRes.data || [];
      const modelsData = modelsRes.data || [];
      const creditsData = creditsRes.data || { total_credits: 0, total_usage: 0 };

      const filteredKeys = ScribeShadeKey ? [ScribeShadeKey] : keys;

      const modelUsage = aggregateByModel(activityItems, modelsData);
      const dailyUsage = aggregateByDay(activityItems);
      const providerUsage = aggregateByProvider(activityItems);

      const totalRequests = activityItems.reduce((sum, i) => sum + i.requests, 0);
      const totalPromptTokens = activityItems.reduce((sum, i) => sum + i.prompt_tokens, 0);
      const totalCompletionTokens = activityItems.reduce((sum, i) => sum + i.completion_tokens, 0);
      const totalReasoningTokens = activityItems.reduce((sum, i) => sum + i.reasoning_tokens, 0);
      const totalTokens = totalPromptTokens + totalCompletionTokens + totalReasoningTokens;
      const totalCost = activityItems.reduce((sum, i) => sum + i.usage, 0);
      const totalByokCost = activityItems.reduce((sum, i) => sum + i.byok_usage_inference, 0);

      const uniqueModels = new Set(activityItems.map(i => i.model)).size;
      const uniqueProviders = new Set(activityItems.map(i => i.provider_name)).size;

      return {
        totalRequests,
        totalPromptTokens,
        totalCompletionTokens,
        totalReasoningTokens,
        totalTokens,
        totalCost,
        totalByokCost,
        uniqueModels,
        uniqueProviders,
        activeKeys: filteredKeys.filter(k => !k.disabled).length,
        totalKeys: filteredKeys.length,
        avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
        dailyUsage,
        modelUsage,
        providerUsage,
        keys: filteredKeys,
        accountTotalCredits: creditsData.total_credits,
        accountTotalUsage: creditsData.total_usage,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to fetch OpenRouter analytics';
      throw new Error(message);
    }
  },

  getActivityByDate: async (input: any, _ctx: any): Promise<OpenRouterActivityItem[]> => {
    try {
      const date = typeof input === 'string' ? input : input?.date;
      const res = await orFetch<{ data: OpenRouterActivityItem[] }>('/activity', { date });
      return res.data || [];
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : 'Failed to fetch activity');
    }
  },

  getAPIKeys: async (_input: any, _ctx: any): Promise<OpenRouterKeyItem[]> => {
    try {
      const res = await orFetch<{ data: OpenRouterKeyItem[] }>('/keys', { include_disabled: 'true' });
      return res.data || [];
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : 'Failed to fetch API keys');
    }
  },

});

export default controller;
export type Procedures = typeof controller.procedures;
