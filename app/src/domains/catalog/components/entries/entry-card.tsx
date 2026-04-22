import { Link } from "@tanstack/react-router";
import { Badge } from "@/platform/ui/badge";
import type { Entry } from "@/types";

interface EntryCardProps {
  /** The catalog entry to render as a browse card. */
  entry: Entry;
  /** Optional slug-to-label mapping for issue area display names. */
  issueAreaLabels?: Record<string, string>;
}

/** Format an entry's location for display (city, state > region > state). */
function formatLocation(entry: Entry): string {
  if (entry.city && entry.state) {
    return `${entry.city}, ${entry.state}`;
  }
  if (entry.region) {
    return entry.region;
  }
  return entry.state ?? "Location not specified";
}

/** Convert a snake_case identifier into a Title Case label. */
function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Browse card for a catalog entry.
 *
 * Links to the canonical profile URL for person/org entries (with
 * view transition support), falling back to the legacy `/entries/:id`
 * route for other entry types.
 */
export function EntryCard({ entry, issueAreaLabels = {} }: EntryCardProps) {
  return (
    <article className="bg-surface-container-lowest rounded-[1.3rem] px-4 py-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div>
              <Link
                to={
                  entry.slug && (entry.type === "person" || entry.type === "organization")
                    ? `/profiles/${entry.type === "person" ? "people" : "organizations"}/$slug`
                    : "/entries/$entryId"
                }
                params={
                  entry.slug && (entry.type === "person" || entry.type === "organization")
                    ? { slug: entry.slug }
                    : { entryId: entry.id }
                }
                viewTransition
                className="type-title-large text-ink-strong hover:text-accent transition-colors"
              >
                <span style={{ viewTransitionName: `entry-name-${entry.id}` }}>{entry.name}</span>
              </Link>
              <p className="type-body-medium text-ink-muted mt-1 font-medium">
                {formatLocation(entry)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">{humanize(entry.type)}</Badge>
              {entry.verified ? <Badge variant="success">Verified</Badge> : null}
              <Badge>{entry.source_count} sources</Badge>
            </div>
          </div>

          {entry.latest_source_date ? (
            <p className="type-body-medium text-ink-muted">
              Latest source: {entry.latest_source_date}
            </p>
          ) : null}
        </div>

        <p className="type-body-medium text-ink-soft">{entry.description}</p>

        {entry.issue_areas.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {entry.issue_areas.slice(0, 4).map((issueArea) => (
              <Badge key={issueArea} variant="warning">
                {issueAreaLabels[issueArea] ?? humanize(issueArea)}
              </Badge>
            ))}
          </div>
        ) : null}

        {entry.source_types.length > 0 ? (
          <div className="type-body-medium text-ink-muted flex flex-wrap gap-2">
            <span className="text-ink-strong font-medium">Mentioned in</span>
            {entry.source_types.slice(0, 4).map((sourceType) => (
              <span key={sourceType} className="bg-surface-container rounded-full px-2.5 py-1">
                {humanize(sourceType)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
