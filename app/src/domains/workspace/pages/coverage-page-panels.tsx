import { Link } from "@tanstack/react-router";
import { MapPin, ShieldCheck } from "lucide-react";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import type {
  CoverageTarget,
  CoverageTargetStatus,
} from "@/domains/workspace/server/coverage-targets";
import {
  countLabel,
  formatDate,
  joined,
  REVIEW_STATE_DISPLAY,
  STATUS_DISPLAY,
  type CoverageReviewState,
} from "./coverage-page-utils";

interface StatusBadgeProps {
  status: CoverageTargetStatus;
}

interface ReviewStateBadgeProps {
  reviewState: CoverageReviewState;
}

interface SummaryMetricProps {
  detail: string;
  label: string;
  value: string;
}

interface CoverageTargetItemProps {
  target: CoverageTarget;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const display = STATUS_DISPLAY[status];
  const Icon = display.Icon;

  return (
    <Badge variant={display.variant} className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {display.label}
    </Badge>
  );
}

function ReviewStateBadge({ reviewState }: ReviewStateBadgeProps) {
  const display = REVIEW_STATE_DISPLAY[reviewState];

  return <Badge variant={display.variant}>{display.label}</Badge>;
}

function SummaryMetric({ label, value, detail }: SummaryMetricProps) {
  return (
    <div className="border-outline-variant bg-surface-container-lowest rounded-lg border p-4">
      <dt className="type-label-small text-ink-muted">{label}</dt>
      <dd className="type-title-large text-ink-strong mt-1">{value}</dd>
      <dd className="type-body-small text-ink-soft mt-1">{detail}</dd>
    </div>
  );
}

function CoverageTargetItem({ target }: CoverageTargetItemProps) {
  const display = STATUS_DISPLAY[target.status];

  return (
    <li
      className="border-outline-variant bg-surface-container-lowest rounded-lg border p-5"
      data-testid={`coverage-target-${target.id}`}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={target.status} />
              <ReviewStateBadge reviewState={target.review_state} />
              <Badge>{formatDate(target.last_reviewed_at)}</Badge>
            </div>
            <div className="space-y-2">
              <h2 className="type-title-large text-ink-strong">
                <Link
                  to="/coverage/$targetId"
                  params={{ targetId: target.id }}
                  className="hover:text-civic transition-colors"
                >
                  {target.name}
                </Link>
              </h2>
              <p className="type-body-medium text-ink-soft">{display.description}</p>
            </div>
          </div>

          <div className="type-body-small text-ink-soft flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {target.geography}
            </span>
            <span>{joined(target.issue_areas)}</span>
            <span>{joined(target.actor_types)}</span>
            <span>{joined(target.source_types)}</span>
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
        </div>

        <dl className="grid grid-cols-3 gap-3 text-right lg:grid-cols-1">
          <div>
            <dt className="type-label-small text-ink-muted">Records</dt>
            <dd className="type-title-small text-ink-strong">
              {countLabel(target.records_found, "record")}
            </dd>
          </div>
          <div>
            <dt className="type-label-small text-ink-muted">Sources</dt>
            <dd className="type-title-small text-ink-strong">
              {countLabel(target.sources_reviewed, "source")}
            </dd>
          </div>
          <div>
            <dt className="type-label-small text-ink-muted">Linked actors</dt>
            <dd className="type-title-small text-ink-strong">
              {countLabel(target.linked_entry_ids.length, "actor")}
            </dd>
          </div>
        </dl>
      </div>
    </li>
  );
}

export function CoverageSummaryMetrics({
  summary,
}: {
  summary: { covered: number; needWork: number; sourcesReviewed: number; targets: number };
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryMetric
        label="Targets"
        value={countLabel(summary.targets, "target")}
        detail="Tracked places and scopes"
      />
      <SummaryMetric
        label="Need work"
        value={countLabel(summary.needWork, "need work", { plural: "need work" })}
        detail="Thin, stale, blocked, or unknown"
      />
      <SummaryMetric
        label="Covered"
        value={String(summary.covered)}
        detail="Ready for confident use"
      />
      <SummaryMetric
        label="Sources"
        value={String(summary.sourcesReviewed)}
        detail="Reviewed across targets"
      />
    </dl>
  );
}

export function CoverageTargetsList({ targets }: { targets: CoverageTarget[] }) {
  if (targets.length === 0) {
    return null;
  }

  return (
    <ul className="space-y-4">
      {targets.map((target) => (
        <CoverageTargetItem key={target.id} target={target} />
      ))}
    </ul>
  );
}

export function CoverageEmptyState() {
  return (
    <section className="border-outline-variant bg-surface-container-lowest flex flex-wrap items-center justify-between gap-4 rounded-lg border p-5">
      <div className="flex items-center gap-3">
        <ShieldCheck className="text-civic h-5 w-5" aria-hidden="true" />
        <p className="type-body-medium text-ink-strong">No coverage targets yet.</p>
      </div>
      <Link
        to="/discovery"
        className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center rounded-lg px-4 transition-colors"
      >
        Research
      </Link>
    </section>
  );
}
