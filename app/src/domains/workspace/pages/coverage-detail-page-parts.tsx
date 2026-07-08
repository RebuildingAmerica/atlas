import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  Bell,
  BellRing,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ExternalLink,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/platform/ui/badge";
import type {
  CoverageTargetDetail,
  CoverageTargetStatus,
} from "@/domains/workspace/server/coverage-targets";
import type { WorkspaceFirehoseSourceTarget } from "@/domains/workspace/server/firehose";

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

export type CoverageReviewState = CoverageTargetDetail["target"]["review_state"];

export const STATUS_DISPLAY: Record<CoverageTargetStatus, StatusDisplay> = {
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

export function countLabel(count: number, singular: string, options?: CountLabelOptions): string {
  const plural = options?.plural ?? `${singular}s`;
  return `${count} ${count === 1 ? singular : plural}`;
}

export function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

export function joined(values: string[]): string {
  if (values.length === 0) {
    return "None listed";
  }

  return values.map(humanize).join(", ");
}

export function formatDate(value: string | null): string {
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

export function formatDateTime(value: string | null): string {
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

export function formatCadence(seconds: number): string {
  if (seconds < 120) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return `${minutes}m`;
  }
  return `${Math.round(minutes / 60)}h`;
}

export function stateFromGeography(geography: string): string {
  const stateMatch = /,\s*([A-Za-z]{2})\s*$/.exec(geography);
  return stateMatch?.[1]?.toUpperCase() ?? "";
}

export function profileLinkForEntry(
  entry: CoverageTargetDetail["entries"][number],
): ProfileLink | null {
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

interface StatusBadgeProps {
  status: CoverageTargetStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const display = STATUS_DISPLAY[status];
  const Icon = display.Icon;

  return (
    <Badge variant={display.variant} className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {display.label}
    </Badge>
  );
}

interface ReviewStateBadgeProps {
  reviewState: CoverageReviewState;
}

export function ReviewStateBadge({ reviewState }: ReviewStateBadgeProps) {
  const display = REVIEW_STATE_DISPLAY[reviewState];

  return <Badge variant={display.variant}>{display.label}</Badge>;
}

interface SourceTargetRowProps {
  target: WorkspaceFirehoseSourceTarget;
}

export function SourceTargetRow({ target }: SourceTargetRowProps) {
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

interface DetailMetricProps {
  detail: string;
  label: string;
  value: string;
}

export function DetailMetric({ detail, label, value }: DetailMetricProps) {
  return (
    <div className="border-outline-variant bg-surface-container-lowest rounded-lg border p-4">
      <dt className="type-label-small text-ink-muted">{label}</dt>
      <dd className="type-title-large text-ink-strong mt-1">{value}</dd>
      <dd className="type-body-small text-ink-soft mt-1">{detail}</dd>
    </div>
  );
}

interface CoverageHeaderActionProps {
  isWatchPending: boolean;
  isWatched: boolean;
  onToggleWatch: () => void;
  researchSearch: {
    issue_areas: string;
    location: string;
    research_goal: "partner_scan";
    state: string;
  };
}

export function CoverageHeaderActions({
  isWatchPending,
  isWatched,
  onToggleWatch,
  researchSearch,
}: CoverageHeaderActionProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={onToggleWatch}
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
  );
}
