import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  MapPin,
  RadioTower,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  useUnwatchWorkspaceResource,
  useWatchWorkspaceResource,
  useWorkspaceWatchStatus,
} from "@/domains/workspace/hooks/use-workspace-watches";
import { Badge } from "@/platform/ui/badge";
import type { CoverageTargetDetail } from "@/domains/workspace/server/coverage-targets";
import type { WorkspaceFirehoseSourceTargetCollection } from "@/domains/workspace/server/firehose";
import {
  countLabel,
  formatDate,
  joined,
  humanize,
  profileLinkForEntry,
  ReviewStateBadge,
  SourceTargetRow,
  stateFromGeography,
  STATUS_DISPLAY,
  StatusBadge,
  DetailMetric,
  CoverageHeaderActions,
} from "./coverage-detail-page-parts";

interface CoverageDetailPageProps {
  detail: CoverageTargetDetail;
  sourceTargets: WorkspaceFirehoseSourceTargetCollection;
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
          <CoverageHeaderActions
            isWatchPending={isWatchPending}
            isWatched={isWatched}
            onToggleWatch={() => {
              if (isWatched) {
                unwatchMutation.mutate(watchInput);
                return;
              }
              watchMutation.mutate(watchInput);
            }}
            researchSearch={researchSearch}
          />
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
