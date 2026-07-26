import type { DateTimeFormatter } from "@rebuildingamerica/atlas-ui/format/date-time";
import { MEDIUM_DATE, useDateTimeFormatter } from "@rebuildingamerica/atlas-ui/format/date-time";
import type { ResearchTrend } from "../server/research-summary";

interface ResearchTrendsSectionProps {
  /** Repeated place and issue patterns derived from recent research. */
  trends: ResearchTrend[];
}

function trendKindLabel(kind: ResearchTrend["kind"]): string {
  return kind === "place" ? "Place" : "Issue";
}

function formatLatestRun(format: DateTimeFormatter, value: string): string {
  return `Latest request ${format(value, MEDIUM_DATE)}`;
}

export function ResearchTrendsSection({ trends }: ResearchTrendsSectionProps) {
  const format = useDateTimeFormatter();

  if (trends.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="type-headline-small text-ink-strong">Research trends</h2>
        <p className="type-body-medium text-ink-soft mt-1">
          Repeated places and issues across recent research.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {trends.map((trend) => (
          <article
            key={trend.id}
            className="border-outline-variant bg-surface-container-lowest rounded-[1rem] border p-4"
          >
            <p className="type-label-small text-ink-muted">{trendKindLabel(trend.kind)}</p>
            <h3 className="type-title-medium text-ink-strong mt-1">{trend.label}</h3>
            <p className="type-body-medium text-ink-soft mt-2">{trend.signal}</p>
            <p className="type-label-small text-ink-muted mt-3">
              {formatLatestRun(format, trend.latestRunAt)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
