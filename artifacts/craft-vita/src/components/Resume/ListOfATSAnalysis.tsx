import { useNavigate } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Eye } from "lucide-react";
import { getAuthHeaders } from "@/lib/globalAuth";

import type { ExportableData } from "@/components/data-table/utils/export-utils";

// interface ATSAnalysisData {
//   id: string;
//   score: number;
//   summary: string;
//   strengths: string[];
//   weaknesses: string[];
//   missingKeywords: string[];
//   suggestions: string[];
//   createdAt: string;
// }

interface AnalyzedResume extends ExportableData {
  id: string;
  filename: string;
  uploadedAt: string;
  atsAnalysis: any;
}

export default function ListOfATSAnalysis() {
  const userId = localStorage.getItem("userId");
  const navigate = useNavigate();

  const fetchAnalyzedResumes = async () => {
    if (!userId) {
      return {
        success: false,
        data: [],
        pagination: { page: 1, limit: 10, total_pages: 1, total_items: 0 },
      };
    }

    const res = await fetch(
      `${import.meta.env.VITE_BACKEND_URL}/api/resume/all-ats?userId=${userId}`,
      { headers: await getAuthHeaders() },
    );
    const data = await res.json();

    return {
      success: true,
      data,
      pagination: {
        page: 1,
        limit: data.length || 10,
        total_pages: 1,
        total_items: data.length || 0,
      },
    };
  };

  const getMatchInfo = (score: number) => {
    if (score >= 85)
      return {
        label: "Excellent",
        color: "text-green-500 bg-green-500/10 border-green-500/20",
      };
    if (score >= 70)
      return {
        label: "Good",
        color: "text-blue-500 bg-blue-500/10 border-blue-500/20",
      };
    if (score >= 50)
      return {
        label: "Fair",
        color:
          "text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
      };
    return {
      label: "Needs Work",
      color: "text-red-500 bg-red-500/10 border-red-500/20",
    };
  };

  const columns: ColumnDef<AnalyzedResume>[] = [
    {
      accessorKey: "filename",
      header: "Resume Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-3 font-medium">
          <FileText className="h-4.5 w-4.5 text-muted-foreground shrink-0" />
          <span className="truncate">{row.getValue("filename")}</span>
        </div>
      ),
    },
    {
      id: "score",
      header: "ATS Score",
      cell: ({ row }) => {
        const score = row.original.atsAnalysis?.score || 0;
        const match = getMatchInfo(score);
        return (
          <div className="flex items-center gap-3">
            <span className="font-semibold text-lg">{score}</span>
            <Badge
              variant="outline"
              className={`text-xs px-2.5 py-0.5 rounded-md border ${match.color}`}
            >
              {match.label}
            </Badge>
          </div>
        );
      },
    },
    {
      id: "analyzedAt",
      header: "Analyzed Date",
      cell: ({ row }) => {
        const dateString =
          row.original.atsAnalysis?.createdAt || row.original.uploadedAt;
        return (
          <span className="text-muted-foreground">
            {new Date(dateString).toLocaleDateString()}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const resume = row.original;

        return (
          <div className="flex justify-end pr-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-foreground transition-colors"
              title="View Details"
              onClick={() => {
                const analysisData = {
                  ...resume.atsAnalysis,
                  filename: resume.filename,
                };
                navigate("/resume/ats-result", {
                  state: { analysis: analysisData },
                });
              }}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  if (!userId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Please log in to view ATS analysis.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DataTable
        getColumns={() => columns}
        fetchDataFn={fetchAnalyzedResumes}
        fetchByIdsFn={async () => []}
        idField="id"
        config={{
          enableSearch: false,
          enableRowSelection: false,
        }}
      />
    </div>
  );
}
