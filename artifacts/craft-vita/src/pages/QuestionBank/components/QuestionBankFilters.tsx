import { Filter, FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { QuestionBankFiltersState } from "../types";

const QUESTION_TYPES = [
  "coding",
  "dsa",
  "system_design",
  "architecture",
  "technical_concept",
  "scenario_based",
  "debugging",
  "database",
  "cloud_devops",
  "behavioral",
  "project_deep_dive",
  "case_study",
  "sql",
  "frontend",
  "backend",
  "data_engineering",
  "security",
  "testing",
];

interface QuestionBankFiltersProps {
  value: QuestionBankFiltersState;
  onChange: (value: QuestionBankFiltersState) => void;
  onClear: () => void;
}

export function QuestionBankFilters({
  value,
  onChange,
  onClear,
}: QuestionBankFiltersProps) {
  const activeCount = Object.values(value).filter(Boolean).length;

  const update = (key: keyof QuestionBankFiltersState, nextValue: string) => {
    onChange({ ...value, [key]: nextValue === "all" ? "" : nextValue });
  };

  return (
    <div className="ml-2 flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="size-4" />
            Filters
            {activeCount > 0 ? (
              <span className="rounded-sm bg-foreground px-1.5 text-[11px] text-background">
                {activeCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(92vw,560px)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">Question filters</p>
            {activeCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClear}
                className="gap-1.5 text-muted-foreground"
              >
                <FilterX className="size-4" />
                Clear
              </Button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              value={value.company}
              onChange={(event) => update("company", event.target.value)}
              placeholder="Company"
            />
            <Input
              value={value.role}
              onChange={(event) => update("role", event.target.value)}
              placeholder="Role"
            />
            <Input
              value={value.technology}
              onChange={(event) => update("technology", event.target.value)}
              placeholder="Technology"
            />
            <Input
              value={value.topic}
              onChange={(event) => update("topic", event.target.value)}
              placeholder="Topic"
            />
            <Input
              value={value.industry}
              onChange={(event) => update("industry", event.target.value)}
              placeholder="Industry"
            />
            <Select
              value={value.questionType || "all"}
              onValueChange={(nextValue) =>
                update("questionType", nextValue)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Question type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All question types</SelectItem>
                {QUESTION_TYPES.map((questionType) => (
                  <SelectItem key={questionType} value={questionType}>
                    {questionType
                      .split("_")
                      .map(
                        (part) =>
                          part.charAt(0).toUpperCase() + part.slice(1),
                      )
                      .join(" ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={value.difficulty || "all"}
              onValueChange={(nextValue) => update("difficulty", nextValue)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Difficulty" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All difficulties</SelectItem>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
                <SelectItem value="expert">Expert</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>
      {activeCount > 0 ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          title="Clear filters"
        >
          <FilterX className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

