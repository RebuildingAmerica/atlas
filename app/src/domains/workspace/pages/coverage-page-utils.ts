import type { LucideIcon } from "lucide-react";
import type { DateTimeFormatter } from "@rebuildingamerica/atlas-ui/format/date-time";
import type {
  CoverageTarget,
  CoverageTargetCollection,
  CoverageTargetStatus,
} from "@/domains/workspace/server/coverage-targets";
import { Ban, CheckCircle2, CircleDashed, Clock3, AlertTriangle } from "lucide-react";
import { MEDIUM_DATE } from "@rebuildingamerica/atlas-ui/format/date-time";

export interface CoveragePageProps {
  initialCoverageTargets: CoverageTargetCollection;
  orgId: string;
}

export interface CountLabelOptions {
  plural?: string;
}

export interface StatusDisplay {
  Icon: LucideIcon;
  description: string;
  label: string;
  variant: "default" | "success" | "warning" | "error" | "info";
}

export interface CoverageSummary {
  covered: number;
  needWork: number;
  sourcesReviewed: number;
  targets: number;
}

export interface ImportFeedback {
  message: string;
  variant: "success" | "error";
}

export type CoverageReviewState = CoverageTarget["review_state"];

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

export const REVIEW_STATE_DISPLAY: Record<
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

export const COVERAGE_TARGET_CSV_COLUMNS = [
  "name",
  "geography",
  "issue_areas",
  "actor_types",
  "source_types",
] as const;

export const COVERAGE_TARGET_CSV_EXAMPLE =
  "Kansas City tenant power,Kansas City MO,housing_affordability,organization,news";

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

/**
 * Renders a review date for coverage and brief surfaces.
 *
 * The two absent-value strings differ on purpose: a target that has never been
 * reviewed is a fact worth stating, while a timestamp we cannot parse is not.
 *
 * @param format - Formatter from `useDateTimeFormatter`, so the string the
 *   server renders survives hydration.
 * @param value - ISO timestamp, or `null` when nothing has been recorded.
 * @returns The formatted date, or the reason there is no date to show.
 */
export function formatDate(format: DateTimeFormatter, value: string | null): string {
  if (!value) {
    return "Not reviewed";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return format(parsed, MEDIUM_DATE);
}

export function summarizeCoverage(targets: CoverageTarget[]): CoverageSummary {
  return targets.reduce<CoverageSummary>(
    (summary, target) => {
      const isCovered = target.status === "covered";
      return {
        covered: summary.covered + (isCovered ? 1 : 0),
        needWork: summary.needWork + (isCovered ? 0 : 1),
        sourcesReviewed: summary.sourcesReviewed + target.sources_reviewed,
        targets: summary.targets + 1,
      };
    },
    {
      covered: 0,
      needWork: 0,
      sourcesReviewed: 0,
      targets: 0,
    },
  );
}

export function coverageReportFilename(orgId: string, extension: "csv" | "json"): string {
  return `atlas-coverage-${orgId}.${extension}`;
}

export function downloadTextFile(filename: string, content: string, mediaType: string) {
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }

  const blob = new Blob([content], { type: mediaType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
