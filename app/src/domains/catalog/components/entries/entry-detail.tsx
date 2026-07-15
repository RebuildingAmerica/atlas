import { Link } from "@tanstack/react-router";
import { Badge } from "@/platform/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/platform/ui/card";
import { formatFreshness } from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { PrivateNotesPanel } from "@/domains/catalog/components/profiles/private-notes-panel";
import { pluralize } from "@/lib/pluralize";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

interface EntryDetailProps {
  entry?: Entry;
  isLoading?: boolean;
  error?: Error | null;
  issueAreaLabels?: Record<string, string>;
}

interface VerificationBadgeInfo {
  variant: "success" | "info" | "warning" | "default";
  label: string;
}

function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatLocation(entry: Entry): string {
  if (entry.city && entry.state) {
    return `${entry.city}, ${entry.state}`;
  }
  if (entry.region) {
    return entry.region;
  }
  return entry.state ?? "Location not specified";
}

function sourcePacketSummary(sources: Entry["sources"]): {
  packetCount: number;
  typeCount: number;
} {
  const packets = sources ?? [];
  return {
    packetCount: packets.length,
    typeCount: new Set(packets.map((source) => source.type)).size,
  };
}

function issueLabel(entry: Entry, issueAreaLabels: Record<string, string>): string {
  const firstIssue = entry.issue_areas[0];
  if (!firstIssue) {
    return "civic";
  }
  return issueAreaLabels[firstIssue] ?? humanize(firstIssue);
}

function researchUseText(entry: Entry, issueAreaLabels: Record<string, string>): string {
  const issue = issueLabel(entry, issueAreaLabels).toLowerCase();
  const locality = entry.geo_specificity === "national" ? "national" : "local";
  return `Evaluate ${entry.name} as a ${locality} ${issue} lead.`;
}

function placePivotLabel(entry: Entry): string | null {
  if (entry.city) {
    return `People and groups in ${entry.city}`;
  }
  if (entry.state) {
    return `People and groups in ${entry.state}`;
  }
  if (entry.region) {
    return `People and groups in ${entry.region}`;
  }
  return null;
}

function placePivotSearch(entry: Entry): Record<string, string> | null {
  if (entry.city && entry.state) {
    return { cities: entry.city, states: entry.state };
  }
  if (entry.state) {
    return { states: entry.state };
  }
  if (entry.region) {
    return { regions: entry.region };
  }
  return null;
}

function sourceNoteLabel(source: NonNullable<Entry["sources"]>[number]): string {
  return source.title ?? source.publication ?? source.url;
}

function verificationBadge(entry: Entry): VerificationBadgeInfo {
  if (entry.claim.status === "pending") {
    return { variant: "warning", label: "Verification under review" };
  }
  if (entry.claim.status === "verified" || entry.trust.level === "subject_verified") {
    return {
      variant: "success",
      label: entry.type === "organization" ? "Verified representative" : "Verified person",
    };
  }
  if (entry.trust.level === "atlas_verified" || entry.verified) {
    return { variant: "success", label: "Atlas-verified" };
  }
  if (entry.trust.level === "corroborated") {
    return { variant: "info", label: "Corroborated" };
  }
  return { variant: "default", label: "Source-linked" };
}

function recordFreshnessWarning(entry: Entry): string | null {
  const freshnessSource = entry.latest_source_date ?? entry.last_seen;
  const freshness = formatFreshness(freshnessSource);
  if (freshness.status === "fresh") {
    return null;
  }
  return `Newest source is ${freshness.label}.`;
}

function sourceStalenessLabel(source: NonNullable<Entry["sources"]>[number]): string | null {
  const status = source.freshness?.staleness_status;
  if (status === "stale") {
    return "Stale source";
  }
  if (status === "aging") {
    return "Aging source";
  }
  if (status === "unknown") {
    return "Undated source";
  }
  return null;
}

function SourceFreshnessWarning({ source }: { source: NonNullable<Entry["sources"]>[number] }) {
  const label = sourceStalenessLabel(source);
  const reason = source.freshness?.staleness_reason;
  if (!label || !reason) {
    return null;
  }

  return (
    <div className="border-outline-variant bg-warning-container mt-3 rounded-xl border px-3 py-2">
      <p className="type-label-medium text-on-warning-container">{label}</p>
      <p className="type-body-medium text-on-warning-container mt-1">{reason}</p>
    </div>
  );
}

export function EntryDetail({
  entry,
  isLoading = false,
  error = null,
  issueAreaLabels = {},
}: EntryDetailProps) {
  if (isLoading) {
    return (
      <p className="type-body-medium text-on-surface-variant">
        Loading source-linked entry details…
      </p>
    );
  }

  if (error) {
    return <p className="type-body-medium text-on-error-container">{error.message}</p>;
  }

  if (!entry) {
    return <p className="type-body-medium text-on-surface-variant">Entry not found.</p>;
  }

  const sourceSummary = sourcePacketSummary(entry.sources);
  const freshnessWarning = recordFreshnessWarning(entry);
  const verification = verificationBadge(entry);
  const placeSearch = placePivotSearch(entry);
  const placeLabel = placePivotLabel(entry);
  const primaryIssue = entry.issue_areas[0] ?? null;
  const primaryIssueLabel = issueLabel(entry, issueAreaLabels);

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl">
        <CardHeader className="border-border space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">{humanize(entry.type)}</Badge>
            <Badge variant={verification.variant}>{verification.label}</Badge>
            <Badge>Source-backed record</Badge>
            <Badge>{pluralize(entry.source_count, "source packet")}</Badge>
          </div>
          <div className="space-y-2">
            <CardTitle className="type-headline-medium">{entry.name}</CardTitle>
            <p className="type-body-medium text-on-surface-variant font-medium">
              {formatLocation(entry)}
            </p>
            {entry.full_address ? (
              <p className="type-body-medium text-ink-soft">{entry.full_address}</p>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {freshnessWarning ? (
            <div className="border-outline-variant bg-warning-container rounded-2xl border px-4 py-3">
              <p className="type-label-medium text-on-warning-container">Stale record</p>
              <p className="type-body-medium text-on-warning-container mt-1">{freshnessWarning}</p>
            </div>
          ) : null}

          <p className="type-body-large text-ink-soft">{entry.description}</p>

          <section className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)]">
            <div className="border-border bg-surface-container rounded-2xl border p-4">
              <p className="type-label-medium text-on-surface-variant uppercase">Research record</p>
              <h2 className="type-title-large text-ink-strong mt-1">What you can use this for</h2>
              <p className="type-body-medium text-ink-soft mt-2">
                {researchUseText(entry, issueAreaLabels)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge>{formatLocation(entry)}</Badge>
                <Badge>{primaryIssueLabel}</Badge>
                <Badge>{humanize(entry.type)}</Badge>
              </div>
            </div>

            <div className="border-border bg-surface-container-lowest rounded-2xl border p-4">
              <p className="type-label-medium text-on-surface-variant uppercase">
                Why this record is usable
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge>{pluralize(entry.source_count, "source packet")}</Badge>
                <Badge variant={verification.variant}>{verification.label}</Badge>
                {entry.latest_source_date ? (
                  <Badge>Latest source: {entry.latest_source_date}</Badge>
                ) : null}
              </div>
            </div>
          </section>

          {placeSearch || primaryIssue ? (
            <section className="border-border rounded-2xl border p-4">
              <p className="type-label-medium text-on-surface-variant uppercase">
                Pivot from this actor
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {placeSearch && placeLabel ? (
                  <Link
                    to="/browse"
                    search={placeSearch}
                    className="type-label-medium border-border text-ink-soft hover:border-border-strong hover:text-ink-strong rounded-full border px-3 py-1.5"
                  >
                    {placeLabel}
                  </Link>
                ) : null}
                {primaryIssue ? (
                  <Link
                    to="/browse"
                    search={{ issue_areas: primaryIssue }}
                    className="type-label-medium border-border text-ink-soft hover:border-border-strong hover:text-ink-strong rounded-full border px-3 py-1.5"
                  >
                    {primaryIssueLabel} actors
                  </Link>
                ) : null}
              </div>
            </section>
          ) : null}

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <p className="type-label-medium text-on-surface-variant uppercase">Contact</p>
              <div className="type-body-medium text-ink-soft space-y-1">
                {entry.website ? (
                  <p>
                    <a
                      href={entry.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link hover:text-link-hover"
                    >
                      {entry.website}
                    </a>
                  </p>
                ) : null}
                {entry.email ? <p>{entry.email}</p> : null}
                {entry.phone ? <p>{entry.phone}</p> : null}
              </div>
            </div>

            <div className="space-y-2">
              <p className="type-label-medium text-on-surface-variant uppercase">Mention types</p>
              <div className="flex flex-wrap gap-2">
                {entry.source_types.map((sourceType) => (
                  <Badge key={sourceType}>{humanize(sourceType)}</Badge>
                ))}
              </div>
            </div>
          </div>

          {entry.issue_areas.length > 0 ? (
            <div className="space-y-2">
              <p className="type-label-medium text-on-surface-variant uppercase">Issue areas</p>
              <div className="flex flex-wrap gap-2">
                {entry.issue_areas.map((issueArea) => (
                  <Badge key={issueArea} variant="warning">
                    {issueAreaLabels[issueArea] ?? humanize(issueArea)}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          <PrivateNotesPanel targetId={entry.id} targetLabel={entry.name} type="entry" />
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader className="space-y-3">
          <div className="space-y-1">
            <CardTitle>Source trail</CardTitle>
            <p className="type-body-medium text-on-surface-variant">Evidence packets</p>
          </div>
          {sourceSummary.packetCount > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Badge>{pluralize(sourceSummary.packetCount, "source packet")}</Badge>
              <Badge>{pluralize(sourceSummary.typeCount, "source type")}</Badge>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {entry.sources?.length ? (
            entry.sources.map((source) => (
              <article key={source.id} className="border-border rounded-2xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{humanize(source.type)}</Badge>
                  {source.publication ? (
                    <span className="type-body-medium text-ink-soft font-medium">
                      {source.publication}
                    </span>
                  ) : null}
                  {source.published_date ? (
                    <span className="type-body-medium text-on-surface-variant">
                      {source.published_date}
                    </span>
                  ) : null}
                </div>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="type-title-large text-link hover:text-link-hover mt-3 block"
                >
                  {source.title ?? source.url}
                </a>
                {source.extraction_context ? (
                  <div className="border-border-strong mt-3 border-l-2 pl-3">
                    <p className="type-label-medium text-on-surface-variant uppercase">
                      Quoted evidence
                    </p>
                    <p className="type-body-medium text-ink-soft mt-1">
                      {source.extraction_context}
                    </p>
                  </div>
                ) : null}
                <SourceFreshnessWarning source={source} />
                <div className="mt-4">
                  <PrivateNotesPanel
                    targetId={source.id}
                    targetLabel={sourceNoteLabel(source)}
                    type="source"
                  />
                </div>
              </article>
            ))
          ) : (
            <p className="type-body-medium text-on-surface-variant">No linked sources yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
