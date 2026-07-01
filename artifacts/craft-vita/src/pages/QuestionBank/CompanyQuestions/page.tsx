import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useNavigate, useParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import {
  fetchCompanyDetail,
  fetchPublicQuestions,
  toDataTablePagination,
} from "../api";
import type {
  CompanyDetail,
  DataTableFetchParams,
  PublicQuestion,
  QuestionBankFiltersState,
} from "../types";
import { EMPTY_QUESTION_BANK_FILTERS } from "../types";
import { QuestionBankAnalyticsPanel } from "../components/QuestionBankAnalyticsPanel";
import { QuestionBankFilters } from "../components/QuestionBankFilters";
import { QuestionDetailSheet } from "../components/QuestionDetailSheet";
import {
  DifficultyBadge,
  formatDate,
  formatQuestionBankValue,
  TagList,
} from "../components/QuestionBankUI";

function CompanyQuestions() {
  const { companySlug } = useParams<{ companySlug: string }>();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [companyDetail, setCompanyDetail] = useState<CompanyDetail | null>(null);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    null,
  );
  const [filters, setFilters] = useState<QuestionBankFiltersState>(
    EMPTY_QUESTION_BANK_FILTERS,
  );

  useEffect(() => {
    if (!companySlug) return;
    let active = true;
    setCompanyError(null);
    fetchCompanyDetail(getToken, companySlug)
      .then((result) => {
        if (active) setCompanyDetail(result);
      })
      .catch((error: unknown) => {
        if (active) {
          setCompanyError(
            error instanceof Error
              ? error.message
              : "Unable to load company details",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [companySlug, getToken]);

  const fetchQuestions = useCallback(
    async (params: DataTableFetchParams) => {
      if (!companySlug) {
        throw new Error("Company slug is required");
      }
      const result = await fetchPublicQuestions(getToken, {
        q: params.search,
        company: companySlug,
        role: filters.role,
        technology: filters.technology,
        topic: filters.topic,
        industry: filters.industry,
        questionType: filters.questionType,
        difficulty: filters.difficulty,
        page: params.page,
        limit: params.limit,
        sort:
          params.sort_by === "frequencyCount"
            ? "frequency"
            : params.sort_by === "difficulty"
              ? "difficulty"
              : "recent",
      });
      return {
        success: true as const,
        data: result.data,
        pagination: toDataTablePagination(result.pagination),
      };
    },
    [companySlug, filters, getToken],
  );

  const columns = useMemo<ColumnDef<PublicQuestion>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Question",
        size: 360,
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
        id: "role",
        header: "Role",
        cell: ({ row }) => row.original.role?.name || "Multiple roles",
      },
      {
        id: "technologies",
        header: "Technologies",
        cell: ({ row }) => (
          <TagList values={row.original.technologies} limit={3} />
        ),
      },
      {
        id: "topics",
        header: "Topics",
        cell: ({ row }) => <TagList values={row.original.topics} limit={3} />,
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
        accessorKey: "frequencyCount",
        header: "Frequency",
        cell: ({ row }) => `${row.original.frequencyCount}x`,
      },
      {
        accessorKey: "lastSeenAt",
        header: "Last seen",
        cell: ({ row }) => formatDate(row.original.lastSeenAt),
      },
    ],
    [],
  );

  if (!companySlug) {
    return <p className="text-sm text-destructive">Company slug is missing.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate("/questions/all")}
          title="Back to Question Bank"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">
            {companyDetail?.company.name || "Company questions"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {companyDetail?.company.industry || "Interview intelligence"} ·{" "}
            {companyDetail?.roles.length || 0} roles
          </p>
          {companyError ? (
            <p className="mt-2 text-sm text-destructive">{companyError}</p>
          ) : null}
        </div>
      </div>

      <QuestionBankAnalyticsPanel
        analytics={companyDetail?.analytics || null}
      />

      <DataTable<PublicQuestion, unknown>
        config={{
          enableSearch: true,
          enableUrlState: false,
          searchPlaceholder: "Search company questions...",
          columnResizingTableId: `question-bank-company-${companySlug}`,
          defaultSortBy: "frequencyCount",
        }}
        getColumns={() => columns}
        fetchDataFn={fetchQuestions}
        idField="id"
        fetchByIdsFn={async () => []}
        renderToolbarContent={() => (
          <QuestionBankFilters
            value={filters}
            onChange={setFilters}
            onClear={() => setFilters(EMPTY_QUESTION_BANK_FILTERS)}
          />
        )}
        onRowClick={(question) => setSelectedQuestionId(question.id)}
      />

      <QuestionDetailSheet
        questionId={selectedQuestionId}
        onOpenChange={(open) => {
          if (!open) setSelectedQuestionId(null);
        }}
      />
    </div>
  );
}

export default CompanyQuestions;
