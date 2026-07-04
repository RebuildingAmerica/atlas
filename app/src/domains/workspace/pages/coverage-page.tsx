import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Download,
  FileJson,
  MapPin,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import {
  useCoverageTargets,
  useImportCoverageTargets,
} from "@/domains/workspace/hooks/use-coverage-targets";
import type {
  CoverageTarget,
  CoverageTargetCollection,
  CoverageTargetStatus,
} from "@/domains/workspace/server/coverage-targets";
import { exportOrgCoverageTargets, getExportOrgCoverageTargetsUrl } from "@/lib/generated/atlas";
import { Badge } from "@/platform/ui/badge";
import { Textarea } from "@/platform/ui/textarea";

interface CoveragePageProps {
  initialCoverageTargets: CoverageTargetCollection;
  orgId: string;
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

interface CoverageSummary {
  covered: number;
  needWork: number;
  sourcesReviewed: number;
  targets: number;
}

interface ImportFeedback {
  message: string;
  variant: "success" | "error";
}

type CoverageReviewState = CoverageTarget["review_state"];

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

const COVERAGE_TARGET_CSV_COLUMNS = [
  "name",
  "geography",
  "issue_areas",
  "actor_types",
  "source_types",
] as const;
const COVERAGE_TARGET_CSV_EXAMPLE =
  "Kansas City tenant power,Kansas City MO,housing_affordability,organization,news";

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

function summarizeCoverage(targets: CoverageTarget[]): CoverageSummary {
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

function coverageReportFilename(orgId: string, extension: "csv" | "json"): string {
  return `atlas-coverage-${orgId}.${extension}`;
}

function downloadTextFile(filename: string, content: string, mediaType: string) {
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

function SummaryMetric({ label, value, detail }: { detail: string; label: string; value: string }) {
  return (
    <div className="border-outline-variant bg-surface-container-lowest rounded-lg border p-4">
      <dt className="type-label-small text-ink-muted">{label}</dt>
      <dd className="type-title-large text-ink-strong mt-1">{value}</dd>
      <dd className="type-body-small text-ink-soft mt-1">{detail}</dd>
    </div>
  );
}

function CoverageTargetItem({ target }: { target: CoverageTarget }) {
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

export function CoveragePage({ initialCoverageTargets, orgId }: CoveragePageProps) {
  const coverageTargetsQuery = useCoverageTargets(initialCoverageTargets, orgId);
  const importCoverageTargets = useImportCoverageTargets();
  const [exportError, setExportError] = useState<string | null>(null);
  const [importCsvText, setImportCsvText] = useState("");
  const [importFeedback, setImportFeedback] = useState<ImportFeedback | null>(null);
  const coverageTargets = coverageTargetsQuery.data;
  const targets = coverageTargets.items;
  const summary = summarizeCoverage(targets);

  async function downloadCsvReport() {
    setExportError(null);
    const response = await fetch(getExportOrgCoverageTargetsUrl(orgId, { format: "csv" }), {
      headers: { Accept: "text/csv" },
    });
    if (!response.ok) {
      setExportError("Coverage export failed.");
      return;
    }
    downloadTextFile(coverageReportFilename(orgId, "csv"), await response.text(), "text/csv");
  }

  async function downloadJsonReport() {
    setExportError(null);
    try {
      const report = await exportOrgCoverageTargets(orgId);
      downloadTextFile(
        coverageReportFilename(orgId, "json"),
        JSON.stringify(report, null, 2),
        "application/json",
      );
    } catch {
      setExportError("Coverage export failed.");
    }
  }

  async function importCsvTargets() {
    const csvText = importCsvText.trim();
    if (!csvText) {
      return;
    }

    setImportFeedback(null);
    try {
      const result = await importCoverageTargets.mutateAsync({ csv_text: importCsvText });
      setImportCsvText("");
      setImportFeedback({
        message: `${countLabel(result.imported, "target")} imported.`,
        variant: "success",
      });
    } catch {
      setImportFeedback({
        message: "Coverage import failed.",
        variant: "error",
      });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-6">
      <Link
        to="/home"
        className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        My Research
      </Link>

      <header className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">Coverage</Badge>
              <Badge>{countLabel(coverageTargets.total, "target")}</Badge>
            </div>
            <div className="space-y-2">
              <h1 className="type-display-small text-ink-strong">Coverage Workspace</h1>
              <p className="type-body-large text-ink-soft max-w-3xl">
                Places, issues, actors, and source sets that need enough proof for outreach.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                void downloadCsvReport();
              }}
              className="type-label-large border-outline-variant text-ink-strong hover:bg-surface-container-low inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 transition-colors"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => {
                void downloadJsonReport();
              }}
              className="type-label-large border-outline-variant text-ink-strong hover:bg-surface-container-low inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 transition-colors"
            >
              <FileJson className="h-4 w-4" aria-hidden="true" />
              Download JSON
            </button>
            <Link
              to="/discovery"
              className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 transition-colors"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Research
            </Link>
          </div>
        </div>

        {exportError ? <p className="type-body-small text-ink-soft">{exportError}</p> : null}

        <section className="border-outline-variant bg-surface-container-lowest rounded-lg border p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="bg-surface-container-low rounded-lg p-3">
                  <p className="type-label-small text-ink-muted">Required columns</p>
                  <p className="type-body-small text-ink-strong mt-1 font-mono break-words">
                    {COVERAGE_TARGET_CSV_COLUMNS.join(", ")}
                  </p>
                </div>
                <div className="bg-surface-container-low rounded-lg p-3">
                  <p className="type-label-small text-ink-muted">Example row</p>
                  <p className="type-body-small text-ink-strong mt-1 font-mono break-all">
                    {COVERAGE_TARGET_CSV_EXAMPLE}
                  </p>
                </div>
              </div>
              <Textarea
                autoComplete="off"
                autoExpand
                label="Coverage target CSV"
                maxRows={10}
                onChange={setImportCsvText}
                placeholder="name,geography,issue_areas,actor_types,source_types"
                rows={3}
                value={importCsvText}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  void importCsvTargets();
                }}
                disabled={importCoverageTargets.isPending || importCsvText.trim().length === 0}
                className="type-label-large bg-civic text-surface hover:bg-civic-strong inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                {importCoverageTargets.isPending ? "Importing" : "Import CSV"}
              </button>
            </div>
          </div>
          {importFeedback ? (
            <p
              className={
                importFeedback.variant === "success"
                  ? "type-body-small text-green-700"
                  : "type-body-small text-red-700"
              }
            >
              {importFeedback.message}
            </p>
          ) : null}
        </section>

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
      </header>

      {targets.length > 0 ? (
        <ul className="space-y-4">
          {targets.map((target) => (
            <CoverageTargetItem key={target.id} target={target} />
          ))}
        </ul>
      ) : (
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
      )}
    </div>
  );
}
