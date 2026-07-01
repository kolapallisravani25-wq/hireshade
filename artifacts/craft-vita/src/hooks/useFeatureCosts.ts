/**
 * useFeatureCosts
 *
 * Loads the active FeatureCost catalog from the backend so UI labels
 * (e.g. "1 cr" on the AI Enhance button) are server-driven instead of
 * hard-coded. Data is cached at module scope for the lifetime of the SPA
 * because pricing changes infrequently.
 */
import { useEffect, useState } from "react";
import { ENDPOINTS } from "../lib/endpoints";

export interface FeatureCost {
  featureKey: string;
  credits: string; // Decimal as string from backend
  label: string;
}

export const FEATURE_KEYS = {
  RESUME_GENERATE: "resume_generate",
  RESUME_ENHANCE_SECTION: "resume_enhance_section",
  RESUME_TAILOR: "resume_tailor",
  RESUME_EXTRACT_FIELDS: "resume_extract_fields",
  RESUME_REWRITE: "resume_rewrite",
  RESUME_INJECT_SKILLS: "resume_inject_skills",
  RESUME_INJECT_KEYWORDS: "resume_inject_keywords",
} as const;

let _cache: FeatureCost[] | null = null;
let _inflight: Promise<FeatureCost[]> | null = null;

async function loadCosts(): Promise<FeatureCost[]> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch(ENDPOINTS.creditsFeatureCosts());
      if (!res.ok) return [];
      const json = await res.json();
      const data: FeatureCost[] = Array.isArray(json?.data) ? json.data : [];
      _cache = data;
      return data;
    } catch {
      return [];
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function useFeatureCosts(): {
  costs: FeatureCost[];
  costFor: (featureKey: string, fallback?: number) => number;
  loaded: boolean;
} {
  const [costs, setCosts] = useState<FeatureCost[]>(_cache ?? []);
  const [loaded, setLoaded] = useState<boolean>(_cache !== null);

  useEffect(() => {
    if (_cache) {
      setCosts(_cache);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    loadCosts().then((data) => {
      if (cancelled) return;
      setCosts(data);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const costFor = (featureKey: string, fallback = 0): number => {
    const row = costs.find((c) => c.featureKey === featureKey);
    if (!row) return fallback;
    const n = Number(row.credits);
    return Number.isFinite(n) ? n : fallback;
  };

  return { costs, costFor, loaded };
}
