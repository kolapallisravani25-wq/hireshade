import { useCallback, useMemo } from "react";
import { useAuth } from "@clerk/clerk-react";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, FileQuestion, LockKeyhole, Share2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { fetchMyQuestions, toDataTablePagination } from "../api";
import type { DataTableFetchParams, MyQuestion } from "../types";
import {
  DifficultyBadge,
  formatDate,
  formatQuestionBankValue,
  TagList,
} from "../components/QuestionBankUI";

function UserQuestions() {
  const { getToken } = useAuth();

  const fetchQuestions = useCallback(
    async (params: DataTableFetchParams) => {
      const result = await fetchMyQuestions(getToken, {
        page: params.page,
        limit: params.limit,
      });
      return {
        success: true as const,
        data: result.data,
        pagination: toDataTablePagination(result.pagination),
      };
    },
    [getToken],
  );

  const columns = useMemo<ColumnDef<MyQuestion>[]>(
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
        id: "companyRole",
        header: "Company / Role",
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.company || "General"}</p>
            <p className="text-xs text-muted-foreground">
              {row.original.role || "Multiple roles"}
            </p>
          </div>
        ),
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
        accessorKey: "difficulty",
        header: "Difficulty",
        cell: ({ row }) => (
          <DifficultyBadge difficulty={row.original.difficulty} />
        ),
      },
      {
        accessorKey: "sessionDate",
        header: "Session date",
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 text-muted-foreground" />
            {formatDate(row.original.sessionDate)}
          </span>
        ),
      },
      {
        accessorKey: "contributionEnabled",
        header: "Contribution",
        cell: ({ row }) =>
          row.original.contributionEnabled ? (
            <Badge variant="secondary" className="gap-1.5">
              <Share2 className="size-3" />
              Enabled
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5">
              <LockKeyhole className="size-3" />
              Private
            </Badge>
          ),
      },
      {
        accessorKey: "visibility",
        header: "Visibility",
        cell: ({ row }) => formatQuestionBankValue(row.original.visibility),
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">My Questions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sanitized questions extracted from your saved interview sessions.
          Raw transcripts are not shown here.
        </p>
      </div>

      <DataTable<MyQuestion, unknown>
        config={{
          enableSearch: false,
          enableUrlState: false,
          columnResizingTableId: "question-bank-my-questions",
          defaultSortBy: "sessionDate",
        }}
        getColumns={() => columns}
        fetchDataFn={fetchQuestions}
        idField="rowKey"
        fetchByIdsFn={async () => []}
      />
    </div>
  );
}

export default UserQuestions;
