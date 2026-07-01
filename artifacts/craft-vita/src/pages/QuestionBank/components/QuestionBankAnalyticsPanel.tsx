import { BarChart3, Layers3, Repeat2, Shapes } from "lucide-react";
import type { QuestionBankAnalytics } from "../types";
import {
  DifficultyMixBar,
  formatQuestionBankValue,
  TagList,
} from "./QuestionBankUI";

export function QuestionBankAnalyticsPanel({
  analytics,
}: {
  analytics: QuestionBankAnalytics | null;
}) {
  if (!analytics) return null;

  const typeEntries = Object.entries(analytics.questionTypeDistribution)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4);

  return (
    <section className="border-y bg-background">
      <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <BarChart3 className="size-4" />
            <span className="text-xs font-medium uppercase">Valid questions</span>
          </div>
          <p className="text-2xl font-semibold">
            {analytics.totalValidQuestions.toLocaleString()}
          </p>
          <DifficultyMixBar mix={analytics.difficultyMix} />
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Layers3 className="size-4" />
            <span className="text-xs font-medium uppercase">Coverage</span>
          </div>
          <p className="text-2xl font-semibold">{analytics.uniqueTopics}</p>
          <TagList values={analytics.topTopics} limit={4} />
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Shapes className="size-4" />
            <span className="text-xs font-medium uppercase">Top technologies</span>
          </div>
          <TagList values={analytics.topTechnologies} limit={6} />
          <div className="space-y-1 text-xs text-muted-foreground">
            {typeEntries.map(([type, count]) => (
              <div key={type} className="flex justify-between gap-3">
                <span>{formatQuestionBankValue(type)}</span>
                <span>{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Repeat2 className="size-4" />
            <span className="text-xs font-medium uppercase">Most repeated</span>
          </div>
          <div className="space-y-2">
            {analytics.mostRepeatedQuestions.slice(0, 3).map((question) => (
              <div key={question.id} className="flex items-start gap-2 text-xs">
                <span className="min-w-6 font-semibold">
                  {question.frequencyCount}x
                </span>
                <span className="line-clamp-2 text-muted-foreground">
                  {question.title}
                </span>
              </div>
            ))}
            {analytics.mostRepeatedQuestions.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No repeated questions yet
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

