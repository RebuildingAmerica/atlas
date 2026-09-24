/**
 * WorkSection — recent-activity strip + issue-focus links for the editorial stack.
 *
 * The signature quote that used to live here now renders as the SignatureQuote
 * panel above this section. WorkSection's two remaining jobs are: (1) a one-line
 * "X sources in last N days · most recent: …" strip and (2) inline anchor links
 * for the entry's issue areas.
 */
import { Link } from "@tanstack/react-router";
import { humanize } from "@rebuildingamerica/atlas-catalog/catalog";
import { MONTH_YEAR, formatStableDateTime } from "@rebuildingamerica/atlas-ui/format/date-time";
import type { Entry, Source } from "@rebuildingamerica/atlas-api-client";

interface WorkSectionProps {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
  showIssueChips?: boolean;
}

function countRecentSources(sources: Source[], windowDays = 90): number {
  const cutoff = Date.now() - windowDays * 86_400_000;
  return sources.filter((source) => {
    const ts = source.published_date ? new Date(source.published_date).getTime() : NaN;
    return Number.isFinite(ts) && ts >= cutoff;
  }).length;
}

function formatMostRecentSource(sources: Source[]): string | null {
  const sorted = sources
    .flatMap((source) => (source.published_date ? [{ source, date: source.published_date }] : []))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const latest = sorted[0];
  if (!latest) {
    return null;
  }
  // `published_date` is a calendar day, so the strip stays pinned to UTC rather
  // than sliding a source into the previous month for western readers.
  const dateLabel = formatStableDateTime(latest.date, MONTH_YEAR);
  if (latest.source.publication) {
    return `${latest.source.publication}, ${dateLabel}`;
  }
  if (latest.source.title) {
    return `${latest.source.title}, ${dateLabel}`;
  }
  return dateLabel;
}

export function WorkSection({ entry, issueAreaLabels, showIssueChips = true }: WorkSectionProps) {
  const sources = entry.sources ?? [];
  const recentCount = countRecentSources(sources);
  const mostRecent = formatMostRecentSource(sources);
  const focusLabels = showIssueChips
    ? entry.issue_areas.map((slug) => ({
        slug,
        label: issueAreaLabels[slug] ?? humanize(slug),
      }))
    : [];

  const hasRecent = mostRecent !== null;
  if (!hasRecent && focusLabels.length === 0) {
    return (
      <section
        aria-labelledby={`work-recent-empty-${entry.id}`}
        className="border-border-taupe bg-paper-faded flex flex-wrap items-baseline gap-x-3 gap-y-1 border px-6 py-4 sm:px-8"
      >
        <h2
          id={`work-recent-empty-${entry.id}`}
          className="text-ink-soft font-mono text-xs font-semibold tracking-[0.14em] uppercase"
        >
          Recent
        </h2>
        <p className="text-ink-soft text-sm">No recent coverage on file.</p>
      </section>
    );
  }

  return (
    <>
      {mostRecent !== null ? (
        <section
          aria-labelledby={`work-recent-${entry.id}`}
          className="border-border-taupe bg-paper-faded flex flex-wrap items-baseline gap-x-3 gap-y-1 border px-6 py-4 sm:px-8"
        >
          <h2
            id={`work-recent-${entry.id}`}
            className="text-ink-soft font-mono text-xs font-semibold tracking-[0.14em] uppercase"
          >
            Recent
          </h2>
          <p className="text-ink-strong text-sm">
            {recentCount > 0 ? (
              <strong className="text-civic font-bold">
                {recentCount} {recentCount === 1 ? "source" : "sources"} in last 90 days
              </strong>
            ) : (
              <span className="text-ink-soft">No coverage in last 90 days</span>
            )}
            <> &mdash; most recent: {mostRecent}</>
          </p>
        </section>
      ) : null}

      {focusLabels.length > 0 ? (
        <section
          aria-labelledby={`work-issues-${entry.id}`}
          className="border-border-taupe bg-surface-container-lowest border px-6 py-5 sm:px-8"
        >
          <h2
            id={`work-issues-${entry.id}`}
            className="text-ink-soft block font-mono text-xs font-semibold tracking-[0.14em] uppercase"
          >
            Issue focus
          </h2>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {focusLabels.map(({ slug, label }) => (
              <li key={slug}>
                <Link
                  to="/profiles"
                  className="text-ink-strong border-ink-strong hover:border-civic hover:text-civic focus-visible:ring-civic border-b pb-0.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
