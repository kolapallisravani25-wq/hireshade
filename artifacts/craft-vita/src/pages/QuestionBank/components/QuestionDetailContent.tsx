import {
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Layers3,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { QuestionDetail } from "../types";
import {
  DifficultyBadge,
  formatDate,
  formatQuestionBankValue,
  TagList,
} from "./QuestionBankUI";

function GuideList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "positive" | "warning";
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm">
            {tone === "positive" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            )}
            <span className="text-muted-foreground">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QuestionDetailContent({ detail }: { detail: QuestionDetail }) {
  const { question, answerGuide, similarQuestions } = detail;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <DifficultyBadge difficulty={question.difficulty} />
          <Badge variant="outline">
            {formatQuestionBankValue(question.questionType)}
          </Badge>
          {question.answerGuideAvailable ? (
            <Badge variant="secondary">Answer guide</Badge>
          ) : null}
        </div>
        <h1 className="text-xl font-semibold leading-snug">
          {question.normalizedQuestion}
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        <div className="space-y-1 border-l-2 pl-3">
          <Building2 className="size-4 text-muted-foreground" />
          <p className="font-medium">{question.company?.name || "General"}</p>
          <p className="text-xs text-muted-foreground">
            {question.role?.name || "Multiple roles"}
          </p>
        </div>
        <div className="space-y-1 border-l-2 pl-3">
          <BarChart3 className="size-4 text-muted-foreground" />
          <p className="font-medium">{question.frequencyCount} occurrences</p>
          <p className="text-xs text-muted-foreground">
            {question.sourceCount} aggregated sources
          </p>
        </div>
        <div className="space-y-1 border-l-2 pl-3">
          <Layers3 className="size-4 text-muted-foreground" />
          <p className="font-medium">{question.complexityScore}/100</p>
          <p className="text-xs text-muted-foreground">Complexity score</p>
        </div>
        <div className="space-y-1 border-l-2 pl-3">
          <CalendarDays className="size-4 text-muted-foreground" />
          <p className="font-medium">{formatDate(question.lastSeenAt)}</p>
          <p className="text-xs text-muted-foreground">Last seen</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Technologies</h2>
          <TagList values={question.technologies} limit={8} />
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Topics</h2>
          <TagList values={question.topics} limit={8} />
        </div>
      </div>

      {answerGuide ? (
        <>
          <Separator />
          <section className="space-y-5">
            <h2 className="text-base font-semibold">Answer guide</h2>
            <GuideList
              title="Recommended approach"
              items={answerGuide.approach}
              tone="positive"
            />
            <GuideList
              title="Key points"
              items={answerGuide.keyPoints}
              tone="positive"
            />
            <GuideList
              title="Common mistakes"
              items={answerGuide.commonMistakes}
              tone="warning"
            />
          </section>
        </>
      ) : null}

      {similarQuestions.length > 0 ? (
        <>
          <Separator />
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Similar questions</h2>
            {similarQuestions.map((similarQuestion) => (
              <div
                key={similarQuestion.id}
                className="border-l-2 pl-3 text-sm"
              >
                <p>{similarQuestion.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {similarQuestion.frequencyCount} occurrences
                </p>
              </div>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}

