import { Link } from "@tanstack/react-router";
import { LeadQualitySignals } from "@/domains/catalog/components/profiles/lead-quality-signals";
import { trackDiscoveryEvent } from "@/domains/catalog/discovery-events";
import { pluralize } from "@/lib/pluralize";
import { Badge } from "@/platform/ui/badge";
import type { Entry, EntryType, SourceType } from "@/types";

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
  variant: "success" | "info" | "warning";
  label: string;
}

/** Map verification and trust state to a browse-card badge. */
function trustBadge(entry: Entry): EntryBadgeInfo | null {
  if (entry.claim?.status === "pending") {
    return { variant: "warning", label: "Claim under review" };
  }
  if (entry.claim?.status === "verified") {
    return { variant: "success", label: "Verified by subject" };
  }

  const level = entry.trust?.level;
  switch (level) {
    case "subject_verified":
      return { variant: "success", label: "Verified by subject" };
    case "atlas_verified":
      return { variant: "success", label: "Atlas-verified" };
    case "corroborated":
      return { variant: "info", label: "Corroborated" };
    default:
      return null;
  }
}

function trustLabel(entry: Entry): string {
  const badge = trustBadge(entry);
  return badge?.label ?? "Source-backed";
}

function sourceSummary(entry: Entry): string {
  const sourceCount = entry.source_count ?? 0;
  const parts = [`${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`];

  if (entry.latest_source_date) {
    parts.push(`latest ${entry.latest_source_date}`);
  }

  parts.push(trustLabel(entry));
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
  const issueArea = context?.issueAreas?.find((value) => (entry.issue_areas ?? []).includes(value));
  if (!issueArea) {
    return null;
  }

  return issueAreaLabels[issueArea] ?? humanize(issueArea);
}

function buildMatchReason(
  entry: Entry,
  context: EntryDiscoveryContext | undefined,
  issueAreaLabels: Record<string, string>,
): string {
  const issueLabel = matchingIssueLabel(entry, context, issueAreaLabels);
  const location = locationReason(entry);

  if (issueLabel) {
    return `works on ${issueLabel}${location ? ` in ${location}` : ""}`;
  }

  const query = context?.query?.trim();
  if (query && entry.name.toLowerCase().includes(query.toLowerCase())) {
    return `name matches "${query}"`;
  }

  if (
    context?.sourceTypes?.some((sourceType) =>
      (entry.source_types ?? []).some((entrySourceType) => entrySourceType === sourceType),
    )
  ) {
    return "has sources in the selected source type";
  }

  if (context?.places?.length && location) {
    return `listed in ${location}`;
  }

  return `${humanize(entry.type).toLowerCase()} with source-linked civic activity`;
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
export function EntryCard({ entry, issueAreaLabels = {}, discoveryContext }: EntryCardProps) {
  const tier = trustBadge(entry);
  const profileRoute = PROFILE_ROUTE_BY_TYPE[entry.type];
  const href = profileHref(entry);
  const matchReason = buildMatchReason(entry, discoveryContext, issueAreaLabels);
  return (
    <article className="bg-surface-container-lowest rounded-[1.3rem] px-4 py-4">
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
              <Badge>Source-backed</Badge>
              <Badge>{pluralize(entry.source_count, "source packet")}</Badge>
            </div>
            <LeadQualitySignals entry={entry} />
          </div>

          {entry.latest_source_date ? (
            <p className="type-body-medium text-ink-muted">
              Latest source: {entry.latest_source_date}
            </p>
          ) : null}
        </div>

        <p className="type-body-medium text-ink-soft">{entry.description}</p>

        <div className="bg-surface-container-low rounded-[1rem] px-3 py-2">
          <p className="type-body-small text-ink-strong">Matched because: {matchReason}</p>
          <p className="type-body-small text-ink-muted mt-1">{sourceSummary(entry)}</p>
        </div>

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
          <a
            href={`${href}#reporting-trail`}
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
        </div>
      </div>
    </article>
  );
}
