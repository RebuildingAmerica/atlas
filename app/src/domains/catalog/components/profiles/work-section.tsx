/**
 * WorkSection — recent-activity strip + issue-focus links for the editorial stack.
 *
 * The signature quote that used to live here now renders as the SignatureQuote
 * panel above this section. WorkSection's two remaining jobs are: (1) a one-line
 * "X sources in last N days · most recent: …" strip and (2) inline anchor links
 * for the entry's issue areas.
 */
import { Link } from "@tanstack/react-router";
import { humanize } from "@/domains/catalog/catalog";
import type { Entry, Source } from "@/types";

interface WorkSectionProps {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
  showIssueChips?: boolean;
}

function countRecentSources(sources: Source[], windowDays = 90): number {
  const cutoff = Date.now() - windowDays * 86_400_000;
  return sources.filter((source) => {
    const reference = source.published_date ?? source.ingested_at;
    if (!reference) {
      return false;
    }
    const ts = new Date(reference).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  }).length;
}

function formatMostRecentSource(sources: Source[]): string | null {
  const sorted = [...sources].sort((a, b) => {
    const aDate = a.published_date ?? a.ingested_at;
    const bDate = b.published_date ?? b.ingested_at;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });
  const latest = sorted[0];
  if (!latest) {
    return null;
  }
  const date = latest.published_date ?? latest.ingested_at;
  const dateLabel = date
    ? new Date(date).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "recently";
  if (latest.publication) {
    return `${latest.publication}, ${dateLabel}`;
  }
  if (latest.title) {
    return `${latest.title}, ${dateLabel}`;
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

  const hasRecent = recentCount > 0 || Boolean(mostRecent);
  if (!hasRecent && focusLabels.length === 0) {
    return null;
  }

  return (
    <>
      {hasRecent ? (
        <section
          aria-label="Recent coverage"
          className="border-border-taupe bg-paper-faded flex flex-wrap items-baseline gap-x-3 gap-y-1 border px-6 py-4 sm:px-8"
        >
          <span className="text-ink-soft font-mono text-xs font-semibold tracking-[0.14em] uppercase">
            Recent
          </span>
          <p className="text-ink-strong text-sm">
            {recentCount > 0 ? (
              <strong className="text-civic font-bold">
                {recentCount} {recentCount === 1 ? "source" : "sources"} in last 90 days
              </strong>
            ) : (
              <span className="text-ink-soft">No coverage in last 90 days</span>
            )}
            {mostRecent ? <> &mdash; most recent: {mostRecent}</> : null}
          </p>
        </section>
      ) : null}

      {focusLabels.length > 0 ? (
        <section
          aria-labelledby={`work-issues-${entry.id}`}
          className="border-border-taupe bg-surface-container-lowest border px-6 py-5 sm:px-8"
        >
          <span
            id={`work-issues-${entry.id}`}
            className="text-ink-soft block font-mono text-xs font-semibold tracking-[0.14em] uppercase"
          >
            Issue focus
          </span>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {focusLabels.map(({ slug, label }) => (
              <li key={slug}>
                <Link
                  to="/profiles"
                  className="text-ink-strong border-ink-strong hover:border-civic hover:text-civic border-b pb-0.5 text-sm font-semibold transition-colors"
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
