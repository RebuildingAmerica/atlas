import type { DiscoveryJobQueueItem, DiscoveryJobQueueResponse } from "@/types";
import type { WorkspaceQualitySummary } from "@/domains/workspace/server/quality-summary";
import {
  confidenceCount,
  formatPercent,
  formatProgressStep,
  formatQueueStatus,
  queueItems,
  stalePreviewItems,
} from "./discovery-page-utils";

interface ResearchOperationsPanelProps {
  isLoading: boolean;
  queue: DiscoveryJobQueueResponse | undefined;
}

export function ResearchOperationsPanel({ isLoading, queue }: ResearchOperationsPanelProps) {
  const counts = queue?.status_counts;
  const queued = counts?.queued ?? 0;
  const running = (counts?.running ?? 0) + (counts?.claimed ?? 0);
  const failed = counts?.failed ?? 0;
  const items = queueItems(queue);

  function renderJob(job: DiscoveryJobQueueItem) {
    const progressStep = formatProgressStep(job.progress);

    return (
      <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]" key={job.id}>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="type-title-small text-ink-strong">{job.location_query}</p>
            <span className="type-label-small border-border text-ink-muted rounded-full border px-2 py-0.5">
              {formatQueueStatus(job.status)}
            </span>
          </div>
          <p className="type-body-small text-ink-soft">
            {job.state} · {job.issue_areas.length} issue areas
          </p>
          {progressStep ? <p className="type-label-small text-ink-muted">{progressStep}</p> : null}
          {job.error_message ? (
            <p className="type-label-small text-red-700">{job.error_message}</p>
          ) : null}
        </div>
        <div className="space-y-1 sm:text-right">
          <p className="type-label-small text-ink-muted">Retry {job.retry_count}</p>
          {job.claimed_by ? (
            <p className="type-label-small text-ink-strong">{job.claimed_by}</p>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <section className="border-border-strong bg-surface space-y-4 rounded-[1rem] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="type-title-large text-ink-strong">Research operations</h2>
          <p className="type-body-medium text-ink-muted">Queue, workers, and retries.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="type-label-medium border-border text-ink-soft rounded-full border px-3 py-1">
            {queued} queued
          </span>
          <span className="type-label-medium border-border text-ink-soft rounded-full border px-3 py-1">
            {running} running
          </span>
          <span className="type-label-medium border-border text-ink-soft rounded-full border px-3 py-1">
            {failed} failed
          </span>
        </div>
      </div>

      {isLoading ? (
        <p className="type-body-medium text-ink-muted">Loading...</p>
      ) : items.length > 0 ? (
        <ol className="divide-border divide-y">{items.map(renderJob)}</ol>
      ) : (
        <p className="type-body-medium text-ink-muted">No research operations queued.</p>
      )}
    </section>
  );
}

interface IngestionQualityPanelProps {
  isLoading: boolean;
  summary: WorkspaceQualitySummary | undefined;
}

export function IngestionQualityPanel({ isLoading, summary }: IngestionQualityPanelProps) {
  const sourceCoverage = summary?.source_coverage;
  const duplicateRisk = summary?.duplicate_risk;
  const staleRecords = summary?.stale_records;
  const stalePreview = stalePreviewItems(summary);

  return (
    <section className="border-border-strong bg-surface space-y-4 rounded-[1rem] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="type-title-large text-ink-strong">Ingestion quality</h2>
          <p className="type-body-medium text-ink-muted">
            Source coverage, duplicates, confidence, stale records.
          </p>
        </div>
        {sourceCoverage ? (
          <span className="type-label-medium border-border text-ink-soft rounded-full border px-3 py-1">
            {sourceCoverage.total_records} records
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="type-body-medium text-ink-muted">Loading...</p>
      ) : summary && sourceCoverage && duplicateRisk && staleRecords ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="border-border rounded-xl border p-3">
              <p className="type-title-small text-ink-strong">
                {formatPercent(sourceCoverage.coverage_percent)}% source-backed
              </p>
              <p className="type-label-small text-ink-muted">
                {sourceCoverage.unsourced_records} unsourced
              </p>
            </div>
            <div className="border-border rounded-xl border p-3">
              <p className="type-title-small text-ink-strong">
                {duplicateRisk.cluster_count} duplicate{" "}
                {duplicateRisk.cluster_count === 1 ? "cluster" : "clusters"}
              </p>
              <p className="type-label-small text-ink-muted">
                {duplicateRisk.record_count} records
              </p>
            </div>
            <div className="border-border rounded-xl border p-3">
              <p className="type-title-small text-ink-strong">{staleRecords.record_count} stale</p>
              <p className="type-label-small text-ink-muted">
                {staleRecords.threshold_days} day threshold
              </p>
            </div>
            <div className="border-border rounded-xl border p-3">
              <p className="type-title-small text-ink-strong">
                {confidenceCount(summary, "corroborated")} corroborated
              </p>
              <p className="type-label-small text-ink-muted">
                {confidenceCount(summary, "partial")} partial ·{" "}
                {confidenceCount(summary, "unverified")} unverified
              </p>
            </div>
          </div>

          {stalePreview.length > 0 ? (
            <div className="space-y-2">
              <p className="type-label-large text-ink-strong">Stale records</p>
              <ul className="divide-border divide-y">
                {stalePreview.map((record) => (
                  <li className="flex flex-wrap justify-between gap-2 py-2" key={record.id}>
                    <span className="type-body-small text-ink-strong">{record.name}</span>
                    <span className="type-label-small text-ink-muted">
                      {record.latest_source_date} · {record.source_count} source
                      {record.source_count === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="type-label-small text-ink-muted">{summary.data_boundary.statement}</p>
        </div>
      ) : (
        <p className="type-body-medium text-ink-muted">No quality signals.</p>
      )}
    </section>
  );
}
