export type QuestionBankDifficulty = "easy" | "medium" | "hard" | "expert";

export type DifficultyMix = Record<QuestionBankDifficulty, number>;

export interface QuestionBankPagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface DataTablePagination {
  page: number;
  limit: number;
  total_pages: number;
  total_items: number;
}

export interface DataTableFetchParams {
  page: number;
  limit: number;
  search: string;
  from_date: string;
  to_date: string;
  sort_by: string;
  sort_order: string;
}

export interface PublicQuestion {
  [key: string]: unknown;
  id: string;
  title: string;
  normalizedQuestion: string;
  company?: { name: string; slug: string };
  role?: { name: string; slug: string };
  industry?: string;
  technologies: string[];
  topics: string[];
  questionType: string;
  difficulty: QuestionBankDifficulty;
  complexityScore: number;
  frequencyCount: number;
  sourceCount: number;
  lastSeenAt: string;
  answerGuideAvailable: boolean;
}

export interface QuestionBankAnalytics {
  totalValidQuestions: number;
  uniqueTopics: number;
  topTechnologies: string[];
  topTopics: string[];
  difficultyMix: DifficultyMix;
  questionTypeDistribution: Record<string, number>;
  mostRepeatedQuestions: Array<{
    id: string;
    title: string;
    frequencyCount: number;
  }>;
}

export interface CompanyExploreItem {
  [key: string]: unknown;
  id: string;
  name: string;
  slug: string;
  industry?: string;
  availableRoles: number;
  validQuestions: number;
  topTechnologies: string[];
  difficultyMix: DifficultyMix;
  lastUpdatedAt: string;
}

export interface RoleExploreItem {
  [key: string]: unknown;
  id: string;
  name: string;
  slug: string;
  seniority?: string;
  category?: string;
  companiesSeenIn: number;
  questionCount: number;
  topTechnologies: string[];
  mostAskedTopics: string[];
  difficultyMix: DifficultyMix;
}

export interface TechnologyExploreItem {
  [key: string]: unknown;
  id: string;
  name: string;
  slug: string;
  category: string;
  relatedRoles: number;
  relatedCompanies: number;
  questionCount: number;
  commonQuestionTypes: string[];
  difficultyMix: DifficultyMix;
}

export interface CompanyDetail {
  company: {
    id: string;
    name: string;
    slug: string;
    industry?: string;
  };
  roles: Array<{
    id: string;
    name: string;
    slug: string;
    questionCount: number;
  }>;
  topTechnologies: string[];
  analytics: QuestionBankAnalytics;
}

export interface QuestionDetail {
  question: PublicQuestion;
  similarQuestions: PublicQuestion[];
  answerGuide?: {
    approach: string[];
    keyPoints: string[];
    commonMistakes: string[];
  };
}

export interface MyQuestion {
  [key: string]: unknown;
  id: string;
  rowKey: string;
  question: string;
  title: string;
  company?: string;
  role?: string;
  sessionDate?: string;
  technologies: string[];
  topics: string[];
  difficulty: QuestionBankDifficulty;
  contributionEnabled: boolean;
  visibility: string;
}

export interface QuestionBankFiltersState {
  company: string;
  role: string;
  technology: string;
  topic: string;
  industry: string;
  questionType: string;
  difficulty: string;
}

export const EMPTY_QUESTION_BANK_FILTERS: QuestionBankFiltersState = {
  company: "",
  role: "",
  technology: "",
  topic: "",
  industry: "",
  questionType: "",
  difficulty: "",
};
