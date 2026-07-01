import React from "react";
import {
  Zap, Brain, MessageSquare, Target, Timer, Network, Layers,
  Workflow, Code2, Settings, Server, Database, Puzzle, Activity,
  GitBranch, Cloud, MonitorCheck, Shield, AlertCircle, Flame,
  BarChart, TrendingUp, Lightbulb, Users, Clock,
} from "lucide-react";
import type { ProjectResponse, ProjectSection, SectionType } from "./types";

// ─── Section Icon Map ──────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  resume_ready_bullets:        Zap,
  introduction:                Brain,
  how_to_explain:              MessageSquare,
  star_story:                  Target,
  thirty_second_summary:       Timer,
  architecture_tree:           Network,
  project_header:              Layers,
  project_metadata:            Layers,
  metadata:                    Layers,
  business_purpose:            Target,
  architecture_diagram:        Network,
  data_flow:                   Workflow,
  training_pipeline:           Workflow,
  feature_engineering:         Code2,
  tech_stack:                  Settings,
  tools_and_technologies:      Settings,
  tools_used:                  Settings,
  channels_and_tools:          Settings,
  cluster_nodes:               Server,
  cluster_and_nodes:           Server,
  data_characteristics:        Database,
  database_schema:             Database,
  dataset_overview:            Database,
  tool_integration_map:        Puzzle,
  why_these_tools:             Puzzle,
  model_selection:             Puzzle,
  methodology:                 Activity,
  cicd_pipeline:               GitBranch,
  environment_setup:           Cloud,
  infrastructure_overview:     Cloud,
  monitoring_alerting:         MonitorCheck,
  monitoring_and_alerting:     MonitorCheck,
  challenges_resolution:       Shield,
  challenges_and_resolutions:  Shield,
  risk_analysis:               AlertCircle,
  production_issues:           Flame,
  performance_optimization:    Zap,
  key_achievements:            BarChart,
  success_metrics:             BarChart,
  evaluation_metrics:          BarChart,
  financial_impact:            TrendingUp,
  technical_learnings:         Lightbulb,
  code_snippets:               Code2,
  campaign_overview:           Target,
  stakeholder_map:             Users,
  project_timeline:            Clock,
  budget_breakdown:            BarChart,
};

export function getSectionIcon(key: string): React.ElementType {
  return ICON_MAP[key] ?? Layers;
}

// ─── normalizeProject ──────────────────────────────────────────────────────────
// Transforms legacy flat JSON shapes into the canonical { projectHeader, sections }
// format consumed by ProjectReportView.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

// ─── Key → SectionType inference (for records stored without a type field) ────
const KEY_TYPE_MAP: Record<string, SectionType> = {
  resume_ready_bullets:        "bullets",
  introduction:                "narrative",
  how_to_explain:              "how_to_explain",
  star_story:                  "star_story",
  thirty_second_summary:       "thirty_second_summary",
  architecture_tree:           "architecture_tree",
  project_header:              "metadata",
  project_metadata:            "metadata",
  metadata:                    "metadata",
  business_purpose:            "key_value_pairs",
  architecture_diagram:        "narrative",
  data_flow:                   "narrative",
  training_pipeline:           "steps",
  feature_engineering:         "narrative",
  tech_stack:                  "tech_tags",
  tools_and_technologies:      "tech_tags",
  tools_used:                  "tech_tags",
  why_these_tools:             "narrative",
  methodology:                 "narrative",
  cicd_pipeline:               "steps",
  environment_setup:           "narrative",
  monitoring_alerting:         "narrative",
  monitoring_and_alerting:     "narrative",
  challenges_resolution:       "challenge_cards",
  challenges_and_resolutions:  "challenge_cards",
  performance_optimization:    "narrative",
  key_achievements:            "metrics",
  success_metrics:             "metrics",
  technical_learnings:         "narrative",
  code_snippets:               "code_snippets",
  key_code_snippets:           "code_snippets",
  database_schema:             "narrative",
  cluster_nodes:               "narrative",
  cluster_and_nodes:           "narrative",
  data_characteristics:        "narrative",
  production_issues:           "narrative",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function push(sections: ProjectSection[], key: string, title: string, subtitle: string, type: SectionType, content: any) {
  if (content == null) return;
  if (Array.isArray(content) && content.length === 0) return;
  sections.push({ key, title, subtitle, type, content });
}

export function normalizeProject(raw: Raw): ProjectResponse {
  // Already normalized — return as-is, but repair sections that were stored
  // without a `type` field, and parse bullet content stored as a JSON string.
  if (Array.isArray(raw?.sections) && raw.sections.length > 0) {
    const repaired = (raw.sections as ProjectSection[]).map((sec) => {
      // Infer missing type from key
      const type: SectionType = sec.type ?? KEY_TYPE_MAP[sec.key] ?? "narrative";

      // Parse bullet content stored as a JSON string
      let { content } = sec;
      if (type === "bullets" && typeof content === "string") {
        try { content = JSON.parse(content); }
        catch { content = [content]; }
      }

      return { ...sec, type, content };
    });
    return { ...raw, sections: repaired } as ProjectResponse;
  }

  const sections: ProjectSection[] = [];

  // ── Resume-Ready Bullets ─────────────────────────────────────────────────
  // The AI may return this as a JSON string ("[...]") rather than a real array;
  // parse it here so BulletsRenderer always receives string[].
  let resumePoints: string[] | null = null;
  if (Array.isArray(raw.resumeReadyPoints)) {
    resumePoints = raw.resumeReadyPoints as string[];
  } else if (typeof raw.resumeReadyPoints === "string" && raw.resumeReadyPoints.trim()) {
    try { resumePoints = JSON.parse(raw.resumeReadyPoints) as string[]; }
    catch { resumePoints = [raw.resumeReadyPoints]; }
  }
  push(sections, "resume_ready_bullets", "Resume-Ready Bullets", "Drop directly onto your resume", "bullets", resumePoints);

  if (raw.introduction) {
    const text = [raw.introduction.summary, raw.introduction.context, raw.introduction.goal]
      .filter(Boolean)
      .join("\n\n");
    push(sections, "introduction", "Introduction", "Project background and objectives", "narrative", text);
  }

  if (raw.howToExplain) {
    push(sections, "how_to_explain", "How to Explain This Project",
      "A conversational walkthrough — exactly how you'd tell it in an interview", "how_to_explain", raw.howToExplain);
  }

  if (raw.businessPurpose) {
    const bp = raw.businessPurpose;
    const fields = [
      { key: "Problem Statement", value: bp.problemStatement },
      { key: "Target Users",      value: bp.targetUsers },
      { key: "Business Goal",     value: bp.businessGoal },
      { key: "Success Criteria",  value: bp.successCriteria },
    ].filter((f) => f.value);
    if (fields.length) push(sections, "business_purpose", "Business Purpose", "Why this project matters", "key_value_pairs", fields);
  }

  if (raw.techStack && typeof raw.techStack === "object") {
    const groups = Object.entries(raw.techStack).map(([category, tags]) => ({
      category: category.charAt(0).toUpperCase() + category.slice(1),
      tags: Array.isArray(tags) ? (tags as string[]) : [String(tags)],
    }));
    push(sections, "tech_stack", "Tech Stack", "Technologies used in this project", "tech_tags", groups);
  }

  if (raw.architecture?.components && Array.isArray(raw.architecture.components)) {
    const cards = raw.architecture.components.map((c: Raw) => ({
      title: c.name,
      body:  c.description,
      badge: Array.isArray(c.tech) ? c.tech.join(", ") : c.tech,
    }));
    push(sections, "architecture_diagram", "Architecture", raw.architecture.overview || "System architecture overview", "cards", cards);
  }

  if (Array.isArray(raw.dataFlow)) {
    push(sections, "data_flow", "Data Flow Diagram", "How data moves through the system", "steps",
      raw.dataFlow.map((d: Raw) => ({ step: d.step, description: d.description })));
  }

  if (Array.isArray(raw.keyAchievements)) {
    push(sections, "key_achievements", "Key Achievements", "Quantifiable impact and results", "metrics", raw.keyAchievements);
  }

  const challenges = raw.challengesAndResolutions ?? raw.challengesResolution ?? null;
  if (Array.isArray(challenges)) {
    push(sections, "challenges_and_resolutions", "Challenges & Resolutions", "Problems faced and how they were solved", "challenge_cards",
      challenges.map((c: Raw) => ({ challenge: c.challenge, solution: c.solution })));
  }

  if (Array.isArray(raw.codeSnippets)) {
    push(sections, "code_snippets", "Code Snippets", "Key implementation examples", "code_snippets",
      raw.codeSnippets.map((s: Raw) => ({
        title:    s.title,
        language: s.language ?? "TypeScript",
        purpose:  s.purpose ?? "",
        code:     s.code,
      })));
  }

  if (Array.isArray(raw.databaseSchema)) {
    const headers = ["Table", "Fields", "Description"];
    const rows = raw.databaseSchema.map((t: Raw) => [
      t.table,
      Array.isArray(t.fields) ? t.fields.join(", ") : String(t.fields),
      t.description ?? "",
    ]);
    push(sections, "database_schema", "Database Schema", "Data models and structure", "table", { headers, rows });
  }

  if (raw.methodology) {
    const fields = Object.entries(raw.methodology).map(([k, v]) => ({
      key:   k.replace(/([A-Z])/g, " $1").trim(),
      value: String(v),
    }));
    push(sections, "methodology", "Methodology", "Development process and workflow", "key_value_pairs", fields);
  }

  if (Array.isArray(raw.ciCdPipeline)) {
    const steps = raw.ciCdPipeline.map((s: Raw) => ({
      step:        s.stage,
      description: `${s.description}${Array.isArray(s.tools) && s.tools.length ? ` (${s.tools.join(", ")})` : ""}`,
    }));
    push(sections, "cicd_pipeline", "CI/CD Pipeline", "Build, test, and deploy automation", "steps", steps);
  }

  if (raw.environmentSetup) {
    const fields = Object.entries(raw.environmentSetup).map(([k, v]) => ({
      key:   k.charAt(0).toUpperCase() + k.slice(1),
      value: String(v),
    }));
    push(sections, "environment_setup", "Environment Setup", "Dev, staging, and production configs", "key_value_pairs", fields);
  }

  if (Array.isArray(raw.whyTheseTools)) {
    push(sections, "why_these_tools", "Why These Tools", "Technology decisions and rationale", "cards",
      raw.whyTheseTools.map((t: Raw) => ({ title: t.tool, body: t.reason })));
  }

  if (raw.clusterAndNodes?.details && Array.isArray(raw.clusterAndNodes.details)) {
    push(sections, "cluster_and_nodes", "Cluster & Nodes", raw.clusterAndNodes.infrastructure ?? "Infrastructure overview", "cards",
      raw.clusterAndNodes.details.map((d: Raw) => ({ title: d.component, body: d.configuration })));
  }

  if (Array.isArray(raw.toolIntegrationMap)) {
    push(sections, "tool_integration_map", "Tool Integration Map", "How systems communicate", "cards",
      raw.toolIntegrationMap.map((t: Raw) => ({ title: t.tool, body: t.interaction, badge: t.role })));
  }

  if (Array.isArray(raw.monitoringAndAlerting)) {
    push(sections, "monitoring_and_alerting", "Monitoring & Alerting", "Observability and incident response", "cards",
      raw.monitoringAndAlerting.map((m: Raw) => ({ title: m.tool, body: m.purpose, badge: m.alertType })));
  }

  if (Array.isArray(raw.performanceOptimization)) {
    push(sections, "performance_optimization", "Performance Optimization", "Tuning and efficiency gains", "cards",
      raw.performanceOptimization.map((p: Raw) => ({
        title: p.area,
        body:  `${p.technique} → ${p.result}`,
        badge: p.result,
      })));
  }

  if (Array.isArray(raw.productionIssues)) {
    push(sections, "production_issues", "Production Issues", "Real incidents and their resolutions", "challenge_cards",
      raw.productionIssues.map((p: Raw) => ({
        challenge: p.impact ? `${p.issue} — ${p.impact}` : p.issue,
        solution:  p.fix,
      })));
  }

  if (raw.dataCharacteristics && typeof raw.dataCharacteristics === "object") {
    const fields = Object.entries(raw.dataCharacteristics).map(([k, v]) => ({
      key:   k.replace(/([A-Z])/g, " $1").trim(),
      value: String(v),
    }));
    push(sections, "data_characteristics", "Data Characteristics", "Volume, velocity, variety, veracity", "key_value_pairs", fields);
  }

  if (Array.isArray(raw.technicalLearnings)) {
    push(sections, "technical_learnings", "Technical Learnings", "Key takeaways and growth areas", "bullets", raw.technicalLearnings);
  }

  return {
    projectHeader: raw.projectHeader ?? { title: "Project", tagline: "", domain: "", duration: "", teamSize: "" },
    sections,
  };
}
