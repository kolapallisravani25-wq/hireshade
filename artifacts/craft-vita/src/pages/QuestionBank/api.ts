import { ENDPOINTS } from "@/lib/endpoints";
import type {
  CompanyDetail,
  CompanyExploreItem,
  DataTablePagination,
  MyQuestion,
  PublicQuestion,
  QuestionBankAnalytics,
  QuestionBankPagination,
  QuestionDetail,
  RoleExploreItem,
  TechnologyExploreItem,
} from "./types";

export type GetToken = () => Promise<string | null>;

export interface ListResponse<T> {
  success: true;
  data: T[];
  pagination: QuestionBankPagination;
}

export interface QuestionListResponse extends ListResponse<PublicQuestion> {
  analytics: QuestionBankAnalytics;
}

interface MyQuestionApiItem {
  id: string;
  question: string;
  title: string;
  company?: string;
  role?: string;
  sessionDate?: string;
  technologies: string[];
  topics: string[];
  difficulty: MyQuestion["difficulty"];
  contributionEnabled: boolean;
  visibility: string;
}

function queryString(params: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

async function questionBankRequest<T>(
  getToken: GetToken,
  url: string,
  method: "GET" | "POST" | "DELETE",
): Promise<T> {
  const token = await getToken();
  if (!token) {
    throw new Error("Question Bank authentication token is unavailable");
  }

  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `Question Bank request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export function toDataTablePagination(
  pagination: QuestionBankPagination,
): DataTablePagination {
  return {
    page: pagination.page,
    limit: pagination.limit,
    total_pages: pagination.pages,
    total_items: pagination.total,
  };
}

export async function fetchPublicQuestions(
  getToken: GetToken,
  params: Record<string, string | number | undefined>,
): Promise<QuestionListResponse> {
  return questionBankRequest<QuestionListResponse>(
    getToken,
    ENDPOINTS.questionBankQuestions(queryString(params)),
    "GET",
  );
}

export async function fetchExploreCompanies(
  getToken: GetToken,
  params: Record<string, string | number | undefined>,
): Promise<ListResponse<CompanyExploreItem>> {
  return questionBankRequest<ListResponse<CompanyExploreItem>>(
    getToken,
    ENDPOINTS.questionBankExploreCompanies(queryString(params)),
    "GET",
  );
}

export async function fetchExploreRoles(
  getToken: GetToken,
  params: Record<string, string | number | undefined>,
): Promise<ListResponse<RoleExploreItem>> {
  return questionBankRequest<ListResponse<RoleExploreItem>>(
    getToken,
    ENDPOINTS.questionBankExploreRoles(queryString(params)),
    "GET",
  );
}

export async function fetchExploreTechnologies(
  getToken: GetToken,
  params: Record<string, string | number | undefined>,
): Promise<ListResponse<TechnologyExploreItem>> {
  return questionBankRequest<ListResponse<TechnologyExploreItem>>(
    getToken,
    ENDPOINTS.questionBankExploreTechnologies(queryString(params)),
    "GET",
  );
}

export async function fetchCompanyDetail(
  getToken: GetToken,
  companySlug: string,
): Promise<CompanyDetail> {
  const response = await questionBankRequest<{
    success: true;
    data: CompanyDetail;
  }>(getToken, ENDPOINTS.questionBankCompany(companySlug), "GET");
  return response.data;
}

export async function fetchQuestionDetail(
  getToken: GetToken,
  questionId: string,
): Promise<QuestionDetail> {
  const response = await questionBankRequest<{
    success: true;
    data: QuestionDetail;
  }>(getToken, ENDPOINTS.questionBankQuestion(questionId), "GET");
  return response.data;
}

export async function fetchMyQuestions(
  getToken: GetToken,
  params: Record<string, string | number | undefined>,
): Promise<ListResponse<MyQuestion>> {
  const response = await questionBankRequest<ListResponse<MyQuestionApiItem>>(
    getToken,
    ENDPOINTS.questionBankMyQuestions(queryString(params)),
    "GET",
  );
  return {
    ...response,
    data: response.data.map((question, index) => ({
      ...question,
      rowKey: `${question.id}:${question.sessionDate || "session"}:${index}`,
    })),
  };
}

export async function saveQuestion(
  getToken: GetToken,
  questionId: string,
): Promise<void> {
  await questionBankRequest<{ success: true }>(
    getToken,
    ENDPOINTS.questionBankSaveQuestion(questionId),
    "POST",
  );
}

export async function unsaveQuestion(
  getToken: GetToken,
  questionId: string,
): Promise<void> {
  await questionBankRequest<{ success: true }>(
    getToken,
    ENDPOINTS.questionBankUnsaveQuestion(questionId),
    "DELETE",
  );
}
