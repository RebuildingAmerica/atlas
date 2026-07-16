import type { WorkspaceQualitySummary } from "@/domains/workspace/server/quality-summary";

type StalePreviewItems = WorkspaceQualitySummary["stale_records"]["records"];

export function confidenceCount(summary: WorkspaceQualitySummary, state: string): number {
  return (
    summary.confidence_distribution.find((bucket) => bucket.state === state)?.record_count ?? 0
  );
}

export function stalePreviewItems(summary: WorkspaceQualitySummary | undefined): StalePreviewItems {
  return summary?.stale_records?.records.slice(0, 3) ?? [];
}
