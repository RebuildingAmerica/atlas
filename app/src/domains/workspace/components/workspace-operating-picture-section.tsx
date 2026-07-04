import { Link } from "@tanstack/react-router";
import { BellRing, FileText, MapPinned, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AtlasBriefCollection } from "@/domains/workspace/server/briefs";
import type { CoverageTargetCollection } from "@/domains/workspace/server/coverage-targets";
import type { WorkspaceUsageSummary } from "@/domains/workspace/server/usage-summary";
import type { WorkspaceWatchCollection } from "@/domains/workspace/server/watches";

type OperatingPictureTarget = "/briefs" | "/coverage" | "/watching" | "/organization";

export type OperatingPictureResource<TData> =
  | {
      data: TData;
      status: "ready";
    }
  | {
      data: null;
      status: "loading";
    }
  | {
      data: null;
      status: "unavailable";
    };

interface WorkspaceOperatingPictureSectionProps {
  briefs: OperatingPictureResource<AtlasBriefCollection>;
  coverageTargets: OperatingPictureResource<CoverageTargetCollection>;
  showRenewalProof: boolean;
  usageSummary: OperatingPictureResource<WorkspaceUsageSummary>;
  watches: OperatingPictureResource<WorkspaceWatchCollection>;
  workspaceLabel: string;
}

interface OperatingPictureItem {
  cta: string;
  detail: string;
  hash?: string;
  Icon: LucideIcon;
  label: string;
  to: OperatingPictureTarget;
  value: string;
}

interface OperatingPictureCardProps {
  item: OperatingPictureItem;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function pendingValue<TData>(resource: OperatingPictureResource<TData>): string | null {
  if (resource.status === "loading") {
    return "Loading";
  }

  if (resource.status === "unavailable") {
    return "Unavailable";
  }

  return null;
}

function readyCountValue<TData>(
  resource: OperatingPictureResource<TData>,
  count: (data: TData) => number,
  singular: string,
  plural?: string,
): string {
  if (resource.status !== "ready") {
    return pendingValue(resource) ?? "Unavailable";
  }

  return countLabel(count(resource.data), singular, plural);
}

function coverageDetail(
  coverageTargets: OperatingPictureResource<CoverageTargetCollection>,
): string {
  if (coverageTargets.status === "loading") {
    return "Loading";
  }

  if (coverageTargets.status === "unavailable") {
    return "Coverage could not load.";
  }

  const targets = coverageTargets.data.items;
  const readyCount = targets.filter(
    (target) => target.review_state === "ready_for_delivery",
  ).length;
  const needsWorkCount = Math.max(coverageTargets.data.total - readyCount, 0);

  if (readyCount === 0 && needsWorkCount === 0) {
    return "No coverage targets yet.";
  }

  return `${readyCount} ready, ${needsWorkCount} needs work`;
}

function proofDetail(usageSummary: OperatingPictureResource<WorkspaceUsageSummary>): string {
  if (usageSummary.status === "loading") {
    return "Loading";
  }

  if (usageSummary.status === "unavailable") {
    return "Proof could not load.";
  }

  const publicRecordsImproved = usageSummary.data.renewal_signals.public_records_improved;

  if (usageSummary.data.total_events === 0) {
    return "No proof events yet.";
  }

  return countLabel(publicRecordsImproved, "public record improved", "public records improved");
}

function buildOperatingPictureItems({
  briefs,
  coverageTargets,
  showRenewalProof,
  usageSummary,
  watches,
}: WorkspaceOperatingPictureSectionProps): OperatingPictureItem[] {
  const items: OperatingPictureItem[] = [
    {
      cta: "Open briefs",
      detail:
        briefs.status === "unavailable"
          ? "Briefs could not load."
          : "Decision artifacts with sources attached.",
      Icon: FileText,
      label: "Briefs",
      to: "/briefs",
      value: readyCountValue(briefs, (data) => data.total, "brief"),
    },
    {
      cta: "Open coverage",
      detail: coverageDetail(coverageTargets),
      Icon: MapPinned,
      label: "Coverage",
      to: "/coverage",
      value: readyCountValue(coverageTargets, (data) => data.total, "coverage target"),
    },
    {
      cta: "Open monitoring",
      detail:
        watches.status === "unavailable"
          ? "Monitoring could not load."
          : "Watched actors and coverage targets.",
      Icon: BellRing,
      label: "Monitoring",
      to: "/watching",
      value: readyCountValue(watches, (data) => data.total, "watched resource"),
    },
  ];

  if (showRenewalProof) {
    items.push({
      cta: "Open proof",
      detail: proofDetail(usageSummary),
      hash: "renewal-proof",
      Icon: ShieldCheck,
      label: "Renewal proof",
      to: "/organization",
      value: readyCountValue(usageSummary, (data) => data.total_events, "proof event"),
    });
  }

  return items;
}

function OperatingPictureCard({ item }: OperatingPictureCardProps) {
  return (
    <article className="border-outline-variant bg-surface-container-lowest flex min-h-52 flex-col justify-between rounded-lg border p-5">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <item.Icon className="text-civic h-4 w-4" aria-hidden="true" />
            <p className="type-label-medium text-ink-muted">{item.label}</p>
          </div>
        </div>
        <div>
          <p className="type-title-large text-ink-strong">{item.value}</p>
          <p className="type-body-small text-ink-soft mt-1">{item.detail}</p>
        </div>
      </div>
      <Link
        hash={item.hash}
        to={item.to}
        className="type-label-large text-civic hover:text-civic-deep mt-5 inline-flex underline-offset-4 hover:underline"
      >
        {item.cta}
      </Link>
    </article>
  );
}

export function WorkspaceOperatingPictureSection(props: WorkspaceOperatingPictureSectionProps) {
  const items = buildOperatingPictureItems(props);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <p className="type-label-medium text-ink-muted">{props.workspaceLabel}</p>
          <h2 className="type-headline-small text-ink-strong">Workspace operating picture</h2>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <OperatingPictureCard key={item.label} item={item} />
        ))}
      </div>
    </section>
  );
}
