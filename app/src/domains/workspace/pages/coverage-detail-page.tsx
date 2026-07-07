import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Bell,
  BellRing,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ExternalLink,
  FileText,
  MapPin,
  RadioTower,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  CoverageTargetDetail,
  CoverageTargetStatus,
} from "@/domains/workspace/server/coverage-targets";
import type {
  WorkspaceFirehoseSourceTarget,
  WorkspaceFirehoseSourceTargetCollection,
} from "@/domains/workspace/server/firehose";
import {
  useUnwatchWorkspaceResource,
  useWatchWorkspaceResource,
  useWorkspaceWatchStatus,
} from "@/domains/workspace/hooks/use-workspace-watches";
import { Badge } from "@/platform/ui/badge";

interface CoverageDetailPageProps {
  detail: CoverageTargetDetail;
  sourceTargets: WorkspaceFirehoseSourceTargetCollection;
}

interface CountLabelOptions {
  plural?: string;
}

interface StatusDisplay {
  Icon: LucideIcon;
  description: string;
  label: string;
  variant: "default" | "success" | "warning" | "error" | "info";
}

interface ProfileLink {
  params: { slug: string };
  to: "/profiles/organizations/$slug" | "/profiles/people/$slug";
}

type CoverageReviewState = CoverageTargetDetail["target"]["review_state"];

const STATUS_DISPLAY: Record<CoverageTargetStatus, StatusDisplay> = {
  blocked: {
    Icon: Ban,
    description: "Latest review failed.",
    label: "Blocked",
    variant: "error",
  },
  covered: {
    Icon: CheckCircle2,
    description: "Current records and sources.",
    label: "Covered",
    variant: "success",
  },
  stale: {
    Icon: Clock3,
    description: "Not reviewed in 90 days.",
    label: "Stale",
    variant: "warning",
  },
  thin: {
    Icon: AlertTriangle,
    description: "Fewer than 3 records or sources.",
    label: "Thin",
    variant: "warning",
  },
  unknown: {
    Icon: CircleDashed,
    description: "No linked records yet.",
    label: "Unknown",
    variant: "default",
  },
};

const REVIEW_STATE_DISPLAY: Record<
  CoverageReviewState,
  { label: string; variant: "default" | "success" | "warning" | "error" | "info" }
> = {
  in_review: {
    label: "In review",
    variant: "info",
  },
  needs_research: {
    label: "Needs research",
    variant: "warning",
  },
  ready_for_delivery: {
    label: "Ready for delivery",
    variant: "success",
  },
};

function countLabel(count: number, singular: string, options?: CountLabelOptions): string {
  const plural = options?.plural ?? `${singular}s`;
  return `${count} ${count === 1 ? singular : plural}`;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

function joined(values: string[]): string {
  if (values.length === 0) {
    return "None listed";
  }

  return values.map(humanize).join(", ");
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not reviewed";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Not checked";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

function formatCadence(seconds: number): string {
  if (seconds < 120) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return `${minutes}m`;
  }
  return `${Math.round(minutes / 60)}h`;
}

function stateFromGeography(geography: string): string {
  const stateMatch = /,\s*([A-Za-z]{2})\s*$/.exec(geography);
  return stateMatch?.[1]?.toUpperCase() ?? "";
}

function profileLinkForEntry(entry: CoverageTargetDetail["entries"][number]): ProfileLink | null {
  if (!entry.slug) {
    return null;
  }
  if (entry.type === "organization") {
    return { to: "/profiles/organizations/$slug", params: { slug: entry.slug } };
  }
  if (entry.type === "person") {
    return { to: "/profiles/people/$slug", params: { slug: entry.slug } };
  }
  return null;
}

function StatusBadge({ status }: { status: CoverageTargetStatus }) {
  const display = STATUS_DISPLAY[status];
  const Icon = display.Icon;

  return (
    <Badge variant={display.variant} className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {display.label}
    </Badge>
  );
}

function ReviewStateBadge({ reviewState }: { reviewState: CoverageReviewState }) {
  const display = REVIEW_STATE_DISPLAY[reviewState];

  return <Badge variant={display.variant}>{display.label}</Badge>;
}

function SourceTargetRow({ target }: { target: WorkspaceFirehoseSourceTarget }) {
  return (
    <li className="border-outline-variant rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <a
            href={target.url}
            className="type-label-large text-ink-strong hover:text-civic inline-flex items-center gap-1.5 transition-colors"
          >
            {target.label}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <p className="type-body-small text-ink-soft">
            {humanize(target.source_class)} | {target.source_kind.toUpperCase()} |{" "}
            {formatCadence(target.cadence_seconds)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant={target.enabled ? "success" : "warning"}>
            {target.enabled ? "Enabled" : "Paused"}
          </Badge>
          {target.public_route_enabled ? <Badge variant="info">Public route</Badge> : null}
        </div>
      </div>
      <div className="type-body-small text-ink-soft mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <span>{formatDateTime(target.last_checked_at)}</span>
        {target.last_http_status ? <span>HTTP {target.last_http_status}</span> : null}
        {target.last_error ? <span>{target.last_error}</span> : null}
      </div>
    </li>
  );
}

function DetailMetric({ label, value, detail }: { detail: string; label: string; value: string }) {
  return (
    <div className="border-outline-variant bg-surface-container-lowest rounded-lg border p-4">
      <dt className="type-label-small text-ink-muted">{label}</dt>
      <dd className="type-title-large text-ink-strong mt-1">{value}</dd>
      <dd className="type-body-small text-ink-soft mt-1">{detail}</dd>
    </div>
  );
}

export function CoverageDetailPage({ detail, sourceTargets }: CoverageDetailPageProps) {
  const target = detail.target;
  const display = STATUS_DISPLAY[target.status];
  const researchState = detail.discovery_runs.at(0)?.state ?? stateFromGeography(target.geography);
  const watchInput = {
    resourceId: target.id,
    resourceType: "coverage_target" as const,
  };
  const watchStatus = useWorkspaceWatchStatus(watchInput, true, target.org_id);
  const watchMutation = useWatchWorkspaceResource();
  const unwatchMutation = useUnwatchWorkspaceResource();
  const isWatched = watchStatus.data?.watched ?? false;
  const isWatchPending =
    watchStatus.isLoading || watchMutation.isPending || unwatchMutation.isPending;
  const researchSearch = {
    issue_areas: target.issue_areas.join(","),
    location: target.geography,
    research_goal: "partner_scan" as const,
    state: researchState,
  };

  function toggleWatch() {
    if (isWatched) {
      unwatchMutation.mutate(watchInput);
      return;
    }
    watchMutation.mutate(watchInput);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-6">
      <Link
        to="/coverage"
        className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Coverage Workspace
      </Link>

      <header className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={target.status} />
              <ReviewStateBadge reviewState={target.review_state} />
              <Badge>{formatDate(target.last_reviewed_at)}</Badge>
            </div>
            <div className="space-y-2">
              <h1 className="type-display-small text-ink-strong">{target.name}</h1>
              <p className="type-body-large text-ink-soft max-w-3xl">{display.description}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={toggleWatch}
              disabled={isWatchPending}
              className="type-label-large border-outline-variant text-ink-strong hover:bg-surface-container-low inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isWatched ? (
                <BellRing className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Bell className="h-4 w-4" aria-hidden="true" />
              )}
              {isWatched ? "Watching" : "Watch target"}
            </button>
            <Link
              to="/discovery"
              search={researchSearch}
              className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 transition-colors"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Research this gap
            </Link>
          </div>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailMetric
            label="Records"
            value={countLabel(target.records_found, "record")}
            detail="Linked actors"
          />
          <DetailMetric
            label="Sources"
            value={countLabel(target.sources_reviewed, "source")}
            detail="Linked receipts"
          />
          <DetailMetric
            label="Research"
            value={countLabel(detail.discovery_runs.length, "request")}
            detail="Linked reviews"
          />
          <DetailMetric
            label="Scope"
            value={target.geography}
            detail={joined(target.issue_areas)}
          />
        </dl>
      </header>

      <section className="border-outline-variant bg-surface-container-lowest space-y-5 rounded-lg border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-civic h-5 w-5" aria-hidden="true" />
            <h2 className="type-title-large text-ink-strong">Review focus</h2>
          </div>
          <Badge>{joined(target.actor_types)}</Badge>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <section className="space-y-2">
            <h3 className="type-label-medium text-ink-muted">Gaps</h3>
            {target.gaps.length > 0 ? (
              <ul className="space-y-2">
                {target.gaps.map((gap) => (
                  <li key={`${gap.label}-${gap.detail}`}>
                    <p className="type-label-medium text-ink-strong">{gap.label}</p>
                    <p className="type-body-small text-ink-soft">{gap.detail}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-body-small text-ink-soft">No gaps listed.</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="type-label-medium text-ink-muted">Next actions</h3>
            {target.next_actions.length > 0 ? (
              <ul className="type-body-small text-ink-soft space-y-1">
                {target.next_actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            ) : (
              <p className="type-body-small text-ink-soft">No next actions listed.</p>
            )}
          </section>
        </div>
      </section>

      <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <RadioTower className="text-civic h-5 w-5" aria-hidden="true" />
            <h2 className="type-title-large text-ink-strong">Firehose sources</h2>
          </div>
          <Badge>{countLabel(sourceTargets.total, "source")}</Badge>
        </div>
        {sourceTargets.items.length > 0 ? (
          <ul className="space-y-3">
            {sourceTargets.items.map((sourceTarget) => (
              <SourceTargetRow key={sourceTarget.id} target={sourceTarget} />
            ))}
          </ul>
        ) : (
          <p className="type-body-medium text-ink-soft">No Firehose sources listed.</p>
        )}
      </section>

      <div
        className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]"
        data-testid="coverage-detail-evidence"
      >
        <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
          <div className="flex items-center gap-3">
            <FileText className="text-civic h-5 w-5" aria-hidden="true" />
            <h2 className="type-title-large text-ink-strong">Linked research</h2>
          </div>
          {detail.discovery_runs.length > 0 ? (
            <ul className="space-y-3">
              {detail.discovery_runs.map((run) => (
                <li key={run.id} className="border-outline-variant rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="type-label-large text-ink-strong">{run.location_query}</p>
                    <Badge>{humanize(run.research_goal)}</Badge>
                  </div>
                  <div className="type-body-small text-ink-soft mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    <span>{joined(run.issue_areas)}</span>
                    <span>{countLabel(run.entries_confirmed, "record")}</span>
                    <span>{countLabel(run.sources_processed, "source")}</span>
                    <span>{formatDate(run.completed_at ?? run.started_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-body-medium text-ink-soft">No linked research yet.</p>
          )}
        </section>

        <section className="border-outline-variant bg-surface-container-lowest space-y-4 rounded-lg border p-5">
          <div className="flex items-center gap-3">
            <Users className="text-civic h-5 w-5" aria-hidden="true" />
            <h2 className="type-title-large text-ink-strong">Linked actors</h2>
          </div>
          {detail.entries.length > 0 ? (
            <ul className="space-y-4">
              {detail.entries.map((entry) => {
                const profileLink = profileLinkForEntry(entry);
                return (
                  <li key={entry.id} className="space-y-3">
                    <div className="space-y-1">
                      {profileLink ? (
                        <Link
                          to={profileLink.to}
                          params={profileLink.params}
                          className="type-label-large text-ink-strong hover:text-civic transition-colors"
                        >
                          {entry.name}
                        </Link>
                      ) : (
                        <p className="type-label-large text-ink-strong">{entry.name}</p>
                      )}
                      <p className="type-body-small text-ink-soft inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                        {[entry.city, entry.state].filter(Boolean).join(", ") ||
                          "Location not listed"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Badge>{countLabel(entry.source_count, "source")}</Badge>
                      {entry.sources.length > 0 ? (
                        <ul className="type-body-small text-ink-soft space-y-1">
                          {entry.sources.map((source) => (
                            <li key={source.id}>
                              <a
                                href={source.url}
                                className="hover:text-civic inline-flex items-center gap-1.5 transition-colors"
                              >
                                {source.title ?? source.publication ?? source.url}
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="type-body-medium text-ink-soft">No linked actors yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
