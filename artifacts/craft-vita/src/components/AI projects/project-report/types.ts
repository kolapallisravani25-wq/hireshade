// ─── Section Content Types ──────────────────────────────────────────────────

export type SectionType =
  | "bullets"
  | "narrative"
  | "how_to_explain"
  | "star_story"
  | "thirty_second_summary"
  | "architecture_tree"
  | "metadata"
  | "code_block"
  | "tech_tags"
  | "steps"
  | "challenge_cards"
  | "metrics"
  | "quote_cards"
  | "key_value_pairs"
  | "comparison_table"
  | "cards"
  | "table"
  | "timeline"
  | "code_snippets";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ProjectSection<T = any> {
  key: string;
  title: string;
  subtitle: string;
  type: SectionType;
  content: T;
}

export interface ProjectResponse {
  projectHeader: {
    title: string;
    tagline: string;
    domain: string;
    duration: string;
    teamSize: string;
    role?: string;
  };
  sections: ProjectSection[];
  scope_limited?: boolean;
  credibility_warning?: boolean;
}

export interface ProjectReportViewProps {
  projects: ProjectResponse[];
  position?: string;
  industry?: string;
  experienceLevel?: string;
  createdAt?: string;
}
