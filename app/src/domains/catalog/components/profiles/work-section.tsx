/**
 * WorkSection — "what they're known for" block in the profile main column.
 *
 * Surfaces a signature quote (pulled from the first source carrying an
 * extraction context), issue-area chips that link out to filtered directory
 * views, and a one-line recent-activity strip. Phase 1 derives all content
 * from existing entry + source fields.
 */
import { Link } from "@tanstack/react-router";
import {
  DetailSection,
  SurfaceBlock,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { Badge } from "@/platform/ui/badge";
import { humanize } from "@/domains/catalog/catalog";
import type { Entry, Source } from "@/types";

interface WorkSectionProps {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
  showIssueChips?: boolean;
}

function findSignatureSource(sources: Source[]): Source | null {
  const candidate = sources.find((source) => source.extraction_context);
  return candidate ?? null;
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
  const signature = findSignatureSource(sources);
  const recentCount = countRecentSources(sources);
  const mostRecent = formatMostRecentSource(sources);
  const focusLabels = showIssueChips
    ? entry.issue_areas.map((slug) => ({
        slug,
        label: issueAreaLabels[slug] ?? humanize(slug),
      }))
    : [];

  const hasContent = signature || focusLabels.length > 0 || mostRecent || recentCount > 0;
  if (!hasContent) {
    return null;
  }

  const sectionTitle =
    entry.type === "organization"
      ? "What this organization does"
      : `What ${entry.name} is known for`;

  return (
    <DetailSection eyebrow="Work" title={sectionTitle}>
      <SurfaceBlock>
        <div className="space-y-5">
          {signature ? (
            <figure className="space-y-2">
              <blockquote className="border-accent type-body-large text-ink-strong border-l-[3px] pl-4 italic">
                {signature.extraction_context}
              </blockquote>
              <figcaption className="type-label-small text-ink-muted">
                {signature.publication ? <span>— {signature.publication}</span> : null}
                {signature.publication && signature.published_date ? <span>, </span> : null}
                {signature.published_date ? <span>{signature.published_date}</span> : null}
              </figcaption>
            </figure>
          ) : null}

          {focusLabels.length > 0 ? (
            <div className="space-y-2">
              <p className="type-label-small text-ink-muted tracking-[0.18em] uppercase">
                Issue focus
              </p>
              <div className="flex flex-wrap gap-2">
                {focusLabels.map(({ slug, label }) => (
                  <Link key={slug} to="/profiles" className="inline-flex">
                    <Badge className="bg-surface-container-high text-ink-strong hover:bg-surface-container-highest cursor-pointer transition-colors">
                      {label}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {mostRecent || recentCount > 0 ? (
            <div className="border-outline-variant border-t pt-4">
              <p className="type-label-small text-ink-muted tracking-[0.18em] uppercase">
                Recent activity
              </p>
              <p className="type-body-medium text-ink-soft mt-1">
                {recentCount > 0
                  ? `${recentCount} ${recentCount === 1 ? "source" : "sources"} in last 90 days`
                  : "No coverage in last 90 days"}
                {mostRecent ? ` · most recent: ${mostRecent}` : ""}
              </p>
            </div>
          ) : null}
        </div>
      </SurfaceBlock>
    </DetailSection>
  );
}
