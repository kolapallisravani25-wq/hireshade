import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Bookmark,
  BookmarkCheck,
  Building2,
  Code2,
  FileQuestion,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchExploreCompanies,
  fetchExploreRoles,
  fetchExploreTechnologies,
  fetchPublicQuestions,
  saveQuestion,
  toDataTablePagination,
  unsaveQuestion,
} from "../api";
import type {
  CompanyExploreItem,
  DataTableFetchParams,
  PublicQuestion,
  QuestionBankAnalytics,
  QuestionBankFiltersState,
  RoleExploreItem,
  TechnologyExploreItem,
} from "../types";
import { EMPTY_QUESTION_BANK_FILTERS } from "../types";
import { QuestionBankAnalyticsPanel } from "../components/QuestionBankAnalyticsPanel";
import { QuestionBankFilters } from "../components/QuestionBankFilters";
import { QuestionDetailSheet } from "../components/QuestionDetailSheet";
import {
  DifficultyBadge,
  DifficultyMixBar,
  formatDate,
  formatQuestionBankValue,
  TagList,
} from "../components/QuestionBankUI";

type ExploreTab = "questions" | "companies" | "roles" | "technologies";

function questionSort(sortBy: string): "recent" | "frequency" | "difficulty" {
  if (sortBy === "frequencyCount") return "frequency";
  if (sortBy === "difficulty") return "difficulty";
  return "recent";
}

function exploreSort(sortBy: string): "recent" | "questions" | "name" {
  if (
    sortBy === "validQuestions" ||
    sortBy === "questionCount" ||
    sortBy === "frequencyCount"
  ) {
    return "questions";
  }
  if (sortBy === "name") return "name";
  return "recent";
}

function AllQuestions() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ExploreTab>("questions");
  const [filters, setFilters] = useState<QuestionBankFiltersState>(
    EMPTY_QUESTION_BANK_FILTERS,
  );
  const [analytics, setAnalytics] = useState<QuestionBankAnalytics | null>(
    null,
  );
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    null,
  );
  const [savedQuestionIds, setSavedQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_QUESTION_BANK_FILTERS);
  }, []);

  const toggleSaved = useCallback(
    async (questionId: string) => {
      const isSaved = savedQuestionIds.has(questionId);
      try {
        if (isSaved) {
          await unsaveQuestion(getToken, questionId);
        } else {
          await saveQuestion(getToken, questionId);
        }
        setSavedQuestionIds((current) => {
          const next = new Set(current);
          if (isSaved) next.delete(questionId);
          else next.add(questionId);
          return next;
        });
        toast.success(isSaved ? "Question removed from saved" : "Question saved");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Unable to update question",
        );
      }
    },
    [getToken, savedQuestionIds],
  );

  const fetchQuestions = useCallback(
    async (params: DataTableFetchParams) => {
      const result = await fetchPublicQuestions(getToken, {
        q: params.search,
        company: filters.company,
        role: filters.role,
        technology: filters.technology,
        topic: filters.topic,
        industry: filters.industry,
        questionType: filters.questionType,
        difficulty: filters.difficulty,
        page: params.page,
        limit: params.limit,
        sort: questionSort(params.sort_by),
      });
      setAnalytics(result.analytics);
      return {
        success: true as const,
        data: result.data,
        pagination: toDataTablePagination(result.pagination),
      };
    },
    [filters, getToken],
  );

  const fetchCompanies = useCallback(
    async (params: DataTableFetchParams) => {
      const result = await fetchExploreCompanies(getToken, {
        q: params.search || filters.company,
        industry: filters.industry,
        technology: filters.technology,
        role: filters.role,
        difficulty: filters.difficulty,
        page: params.page,
        limit: params.limit,
        sort: exploreSort(params.sort_by),
      });
      return {
        success: true as const,
        data: result.data,
        pagination: toDataTablePagination(result.pagination),
      };
    },
    [filters, getToken],
  );

  const fetchRoles = useCallback(
    async (params: DataTableFetchParams) => {
      const result = await fetchExploreRoles(getToken, {
        q: params.search || filters.role,
        industry: filters.industry,
        technology: filters.technology,
        role: filters.role,
        difficulty: filters.difficulty,
        page: params.page,
        limit: params.limit,
        sort: exploreSort(params.sort_by),
      });
      return {
        success: true as const,
        data: result.data,
        pagination: toDataTablePagination(result.pagination),
      };
    },
    [filters, getToken],
  );

  const fetchTechnologies = useCallback(
    async (params: DataTableFetchParams) => {
      const result = await fetchExploreTechnologies(getToken, {
        q: params.search || filters.technology,
        industry: filters.industry,
        technology: filters.technology,
        role: filters.role,
        difficulty: filters.difficulty,
        page: params.page,
        limit: params.limit,
        sort: exploreSort(params.sort_by),
      });
      return {
        success: true as const,
        data: result.data,
        pagination: toDataTablePagination(result.pagination),
      };
    },
    [filters, getToken],
  );

  const questionColumns = useMemo<ColumnDef<PublicQuestion>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Question",
        size: 330,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded border bg-muted/50">
              <FileQuestion className="size-4 text-muted-foreground" />
            </div>
            <span className="line-clamp-2 font-medium">
              {row.original.title}
            </span>
          </div>
        ),
      },
      {
        id: "company",
        header: "Company / Role",
        size: 180,
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.company?.name || "General"}</p>
            <p className="text-xs text-muted-foreground">
              {row.original.role?.name || "Multiple roles"}
            </p>
          </div>
        ),
      },
      {
        id: "technologies",
        header: "Technologies",
        size: 210,
        cell: ({ row }) => (
          <TagList values={row.original.technologies} limit={2} />
        ),
      },
      {
        id: "topics",
        header: "Topics",
        size: 190,
        cell: ({ row }) => <TagList values={row.original.topics} limit={2} />,
      },
      {
        accessorKey: "questionType",
        header: "Type",
        cell: ({ row }) => formatQuestionBankValue(row.original.questionType),
      },
      {
        accessorKey: "difficulty",
        header: "Difficulty",
        cell: ({ row }) => (
          <DifficultyBadge difficulty={row.original.difficulty} />
        ),
      },
      {
        accessorKey: "complexityScore",
        header: "Complexity",
        cell: ({ row }) => `${row.original.complexityScore}/100`,
      },
      {
        accessorKey: "frequencyCount",
        header: "Frequency",
        cell: ({ row }) => `${row.original.frequencyCount}x`,
      },
      {
        accessorKey: "lastSeenAt",
        header: "Last seen",
        cell: ({ row }) => formatDate(row.original.lastSeenAt),
      },
      {
        id: "save",
        header: "",
        size: 52,
        cell: ({ row }) => {
          const isSaved = savedQuestionIds.has(row.original.id);
          return (
            <Button
              variant="ghost"
              size="icon-sm"
              title={isSaved ? "Remove saved question" : "Save question"}
              onClick={(event) => {
                event.stopPropagation();
                void toggleSaved(row.original.id);
              }}
            >
              {isSaved ? (
                <BookmarkCheck className="size-4" />
              ) : (
                <Bookmark className="size-4" />
              )}
            </Button>
          );
        },
      },
    ],
    [savedQuestionIds, toggleSaved],
  );

  const companyColumns = useMemo<ColumnDef<CompanyExploreItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Company",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded border bg-muted/50">
              <Building2 className="size-4" />
            </div>
            <div>
              <p className="font-medium">{row.original.name}</p>
              <p className="text-xs text-muted-foreground">
                {row.original.industry || "Industry not specified"}
              </p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "availableRoles",
        header: "Roles",
      },
      {
        accessorKey: "validQuestions",
        header: "Valid questions",
      },
      {
        id: "topTechnologies",
        header: "Top technologies",
        cell: ({ row }) => (
          <TagList values={row.original.topTechnologies} limit={3} />
        ),
      },
      {
        accessorKey: "lastUpdatedAt",
        header: "Last updated",
        cell: ({ row }) => formatDate(row.original.lastUpdatedAt),
      },
    ],
    [],
  );

  const roleColumns = useMemo<ColumnDef<RoleExploreItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Role",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded border bg-muted/50">
              <Users className="size-4" />
            </div>
            <div>
              <p className="font-medium">{row.original.name}</p>
              <p className="text-xs text-muted-foreground">
                {row.original.category || row.original.seniority || "Role"}
              </p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "companiesSeenIn",
        header: "Companies",
      },
      {
        accessorKey: "questionCount",
        header: "Questions",
      },
      {
        id: "topTechnologies",
        header: "Top technologies",
        cell: ({ row }) => (
          <TagList values={row.original.topTechnologies} limit={3} />
        ),
      },
      {
        id: "mostAskedTopics",
        header: "Top topics",
        cell: ({ row }) => (
          <TagList values={row.original.mostAskedTopics} limit={3} />
        ),
      },
      {
        id: "difficultyMix",
        header: "Difficulty mix",
        cell: ({ row }) => (
          <DifficultyMixBar mix={row.original.difficultyMix} />
        ),
      },
    ],
    [],
  );

  const technologyColumns = useMemo<ColumnDef<TechnologyExploreItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Technology",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded border bg-muted/50">
              <Code2 className="size-4" />
            </div>
            <div>
              <p className="font-medium">{row.original.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatQuestionBankValue(row.original.category)}
              </p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "relatedRoles",
        header: "Roles",
      },
      {
        accessorKey: "relatedCompanies",
        header: "Companies",
      },
      {
        accessorKey: "questionCount",
        header: "Questions",
      },
      {
        id: "commonQuestionTypes",
        header: "Question types",
        cell: ({ row }) => (
          <TagList
            values={row.original.commonQuestionTypes.map(
              formatQuestionBankValue,
            )}
            limit={3}
          />
        ),
      },
      {
        id: "difficultyMix",
        header: "Difficulty mix",
        cell: ({ row }) => (
          <DifficultyMixBar mix={row.original.difficultyMix} />
        ),
      },
    ],
    [],
  );

  const toolbar = useCallback(
    () => (
      <QuestionBankFilters
        value={filters}
        onChange={setFilters}
        onClear={clearFilters}
      />
    ),
    [clearFilters, filters],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Question Bank</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Explore privacy-safe interview patterns aggregated across companies,
          roles, and technologies.
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ExploreTab)}
      >
        <TabsList variant="line" className="flex-wrap">
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="technologies">Technologies</TabsTrigger>
        </TabsList>

        <TabsContent value="questions" className="space-y-4">
          <QuestionBankAnalyticsPanel analytics={analytics} />
          <DataTable<PublicQuestion, unknown>
            config={{
              enableSearch: true,
              enableUrlState: false,
              searchPlaceholder: "Search questions...",
              columnResizingTableId: "question-bank-questions",
              defaultSortBy: "lastSeenAt",
            }}
            getColumns={() => questionColumns}
            fetchDataFn={fetchQuestions}
            idField="id"
            fetchByIdsFn={async () => []}
            renderToolbarContent={toolbar}
            onRowClick={(question) => setSelectedQuestionId(question.id)}
          />
        </TabsContent>

        <TabsContent value="companies">
          <DataTable<CompanyExploreItem, unknown>
            config={{
              enableSearch: true,
              enableUrlState: false,
              searchPlaceholder: "Search companies...",
              columnResizingTableId: "question-bank-companies",
              defaultSortBy: "validQuestions",
            }}
            getColumns={() => companyColumns}
            fetchDataFn={fetchCompanies}
            idField="id"
            fetchByIdsFn={async () => []}
            renderToolbarContent={toolbar}
            onRowClick={(company) =>
              navigate(`/questions/company/${company.slug}`)
            }
          />
        </TabsContent>

        <TabsContent value="roles">
          <DataTable<RoleExploreItem, unknown>
            config={{
              enableSearch: true,
              enableUrlState: false,
              searchPlaceholder: "Search roles...",
              columnResizingTableId: "question-bank-roles",
              defaultSortBy: "questionCount",
            }}
            getColumns={() => roleColumns}
            fetchDataFn={fetchRoles}
            idField="id"
            fetchByIdsFn={async () => []}
            renderToolbarContent={toolbar}
          />
        </TabsContent>

        <TabsContent value="technologies">
          <DataTable<TechnologyExploreItem, unknown>
            config={{
              enableSearch: true,
              enableUrlState: false,
              searchPlaceholder: "Search technologies...",
              columnResizingTableId: "question-bank-technologies",
              defaultSortBy: "questionCount",
            }}
            getColumns={() => technologyColumns}
            fetchDataFn={fetchTechnologies}
            idField="id"
            fetchByIdsFn={async () => []}
            renderToolbarContent={toolbar}
          />
        </TabsContent>
      </Tabs>

      <QuestionDetailSheet
        questionId={selectedQuestionId}
        onOpenChange={(open) => {
          if (!open) setSelectedQuestionId(null);
        }}
      />
    </div>
  );
}

export default AllQuestions;
