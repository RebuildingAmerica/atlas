import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, FileJson, Search, Upload } from "lucide-react";
import { useState } from "react";
import {
  useImportCoverageTargets,
  useWorkspaceCoverage,
} from "@/domains/workspace/hooks/use-coverage-targets";
import {
  exportOrgCoverageTargets,
  getExportOrgCoverageTargetsUrl,
} from "@rebuildingamerica/atlas-api-client/generated/atlas";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import { Textarea } from "@rebuildingamerica/atlas-ui/ui/textarea";
import type { ImportFeedback } from "./coverage-page-utils";
import {
  COVERAGE_TARGET_CSV_COLUMNS,
  COVERAGE_TARGET_CSV_EXAMPLE,
  countLabel,
  coverageReportFilename,
  downloadTextFile,
  summarizeCoverage,
} from "./coverage-page-utils";
import {
  CoverageEmptyState,
  CoverageSummaryMetrics,
  CoverageTargetsList,
} from "./coverage-page-panels";

export function CoveragePage() {
  const coverageWorkspaceQuery = useWorkspaceCoverage();
  const importCoverageTargets = useImportCoverageTargets();
  const [exportError, setExportError] = useState<string | null>(null);
  const [importCsvText, setImportCsvText] = useState("");
  const [importFeedback, setImportFeedback] = useState<ImportFeedback | null>(null);
  const { coverageTargets, orgId } = coverageWorkspaceQuery.data;
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

  // The import button is disabled until the textarea holds rows, so this only
  // ever runs with CSV text to send.
  async function importCsvTargets() {
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

        <CoverageSummaryMetrics summary={summary} />
      </header>

      {targets.length > 0 ? <CoverageTargetsList targets={targets} /> : <CoverageEmptyState />}
    </div>
  );
}
