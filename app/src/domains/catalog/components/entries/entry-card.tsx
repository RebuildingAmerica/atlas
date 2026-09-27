import { Link } from "@tanstack/react-router";
import { trackDiscoveryEvent } from "@/domains/catalog/discovery-events";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import type { Entry, EntryType, SourceType } from "@rebuildingamerica/atlas-api-client";

export interface EntryDiscoveryContext {
  issueAreas?: string[];
  places?: string[];
  query?: string;
  sourceTypes?: SourceType[] | string[];
}

interface EntryCardProps {
  /** The catalog entry to render as a browse card. */
  entry: Entry;
  /** Optional slug-to-label mapping for issue area display names. */
  issueAreaLabels?: Record<string, string>;
  discoveryContext?: EntryDiscoveryContext;
  isMapSelection?: boolean;
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

interface EntryBadgeInfo {
  variant: "success" | "warning";
  label: string;
}

/** Map verification and trust state to a browse-card badge. */
function trustBadge(entry: Entry): EntryBadgeInfo | null {
  if (entry.type !== "person" && entry.type !== "organization") {
    return null;
  }

  if (entry.claim?.status === "pending") {
    return { variant: "warning", label: "Verification under review" };
  }
  if (entry.claim?.status === "verified") {
    return { variant: "success", label: subjectVerifiedLabel(entry.type) };
  }

  return entry.trust?.level === "subject_verified"
    ? { variant: "success", label: subjectVerifiedLabel(entry.type) }
    : null;
}

function subjectVerifiedLabel(type: EntryType): string {
  return type === "organization" ? "Verified representative" : "Verified person";
}

function sourceSummary(entry: Entry): string {
  const sourceCount = entry.source_count;
  if (sourceCount === 0) return "No sources listed";
  const parts = [`${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`];

  if (entry.latest_source_date) {
    parts.push(`Latest source ${entry.latest_source_date}`);
  }

  return parts.join(" · ");
}

function profileHref(entry: Entry): string {
  if (!entry.slug) {
    return `/entries/${entry.id}`;
  }

  if (entry.type === "person") {
    return `/profiles/people/${entry.slug}`;
  }
  if (entry.type === "organization") {
    return `/profiles/organizations/${entry.slug}`;
  }

  return `/profiles/${entry.type}s/${entry.slug}`;
}

function locationReason(entry: Entry): string | null {
  const location = formatLocation(entry);
  return location === "Location not specified" ? null : location;
}

function matchingIssueLabel(
  entry: Entry,
  context: EntryDiscoveryContext | undefined,
  issueAreaLabels: Record<string, string>,
): string | null {
  const issueArea = context?.issueAreas?.find((value) => entry.issue_areas.includes(value));
  if (!issueArea) {
    return null;
  }

  return issueAreaLabels[issueArea] ?? humanize(issueArea);
}

function buildMatchReason(
  entry: Entry,
  context: EntryDiscoveryContext | undefined,
  issueAreaLabels: Record<string, string>,
): string | null {
  const issueLabel = matchingIssueLabel(entry, context, issueAreaLabels);
  const location = locationReason(entry);

  if (issueLabel) {
    return `Issue: ${issueLabel}${location ? ` · Listed in ${location}` : ""}`;
  }

  const query = context?.query?.trim();
  if (query && entry.name.toLowerCase().includes(query.toLowerCase())) {
    return `Name matches “${query}”`;
  }

  if (
    context?.sourceTypes?.some((sourceType) =>
      entry.source_types.some((entrySourceType) => entrySourceType === sourceType),
    )
  ) {
    return "Source type matches";
  }

  if (context?.places?.length && location) {
    return `Listed in ${location}`;
  }

  return null;
}

const PROFILE_ROUTE_BY_TYPE = {
  person: "/profiles/people/$slug",
  organization: "/profiles/organizations/$slug",
  initiative: "/profiles/initiatives/$slug",
  campaign: "/profiles/campaigns/$slug",
  event: "/profiles/events/$slug",
} satisfies Record<EntryType, string>;

/**
 * Browse card for a catalog entry.
 *
 * Links to the canonical profile URL when a slug exists, falling back
 * to the legacy `/entries/:id` route for slugless records.
 */
export function EntryCard({
  entry,
  issueAreaLabels = {},
  discoveryContext,
  isMapSelection = false,
}: EntryCardProps) {
  const tier = trustBadge(entry);
  const profileRoute = PROFILE_ROUTE_BY_TYPE[entry.type];
  const href = profileHref(entry);
  const matchReason = buildMatchReason(entry, discoveryContext, issueAreaLabels);
  return (
    <article
      id={isMapSelection ? "selected-map-result" : undefined}
      className={`bg-surface-container-lowest rounded-[1.3rem] px-4 py-4 ${isMapSelection ? "ring-accent ring-2" : ""}`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div>
              <Link
                to={entry.slug ? profileRoute : "/entries/$entryId"}
                params={entry.slug ? { slug: entry.slug } : { entryId: entry.id }}
                viewTransition
                onClick={() => {
                  trackDiscoveryEvent("catalog_profile_opened", {
                    entry_id: entry.id,
                    entry_type: entry.type,
                    source: "result_card_title",
                  });
                }}
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
              {tier ? <Badge variant={tier.variant}>{tier.label}</Badge> : null}
            </div>
          </div>
        </div>

        <p className="type-body-medium text-ink-soft line-clamp-3 break-words">
          {entry.description}
        </p>

        <div className="bg-surface-container-low rounded-[1rem] px-3 py-2">
          {matchReason ? <p className="type-body-small text-ink-strong">{matchReason}</p> : null}
          <p className="type-body-small text-ink-muted mt-1">{sourceSummary(entry)}</p>
        </div>

        {entry.issue_areas.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {entry.issue_areas.slice(0, 2).map((issueArea) => (
              <Badge key={issueArea} variant="warning">
                {issueAreaLabels[issueArea] ?? humanize(issueArea)}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Link
            to={entry.slug ? profileRoute : "/entries/$entryId"}
            params={entry.slug ? { slug: entry.slug } : { entryId: entry.id }}
            onClick={() => {
              trackDiscoveryEvent("catalog_profile_opened", {
                entry_id: entry.id,
                entry_type: entry.type,
                source: "result_card_action",
              });
            }}
            className="type-label-large bg-ink-strong text-surface hover:bg-ink rounded-full px-3 py-1.5 transition-colors"
          >
            Open profile
          </Link>
          {entry.source_count > 0 && entry.slug ? (
            <a
              href={`${href}#${entry.type === "organization" ? "appearances" : "reporting-trail"}`}
              onClick={() => {
                trackDiscoveryEvent("catalog_sources_inspected", {
                  entry_id: entry.id,
                  entry_type: entry.type,
                });
              }}
              className="type-label-large bg-surface-container text-ink-soft hover:text-ink-strong rounded-full px-3 py-1.5 transition-colors"
            >
              Inspect sources
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
