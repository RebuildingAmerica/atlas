import type {
  DiscoveryJobProgress,
  DiscoveryJobQueueItem,
  DiscoveryJobQueueResponse,
} from "@rebuildingamerica/atlas-api-client";
import type { WorkspaceQualitySummary } from "@/domains/workspace/server/quality-summary";

type StalePreviewItems = WorkspaceQualitySummary["stale_records"]["records"];

export function prefilledIssueAreas(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((issueArea) => issueArea.trim())
    .filter(Boolean);
}

export function formatQueueStatus(status: string): string {
  if (status === "claimed") {
    return "running";
  }

  return status;
}

export function formatProgressStep(
  progress: DiscoveryJobProgress | null | undefined,
): string | null {
  const rawStep = progress?.step;
  if (typeof rawStep !== "string" || rawStep.length === 0) {
    return null;
  }

  return rawStep.replaceAll("_", " ");
}

export function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function confidenceCount(summary: WorkspaceQualitySummary, state: string): number {
  return (
    summary.confidence_distribution.find((bucket) => bucket.state === state)?.record_count ?? 0
  );
}

export function stalePreviewItems(summary: WorkspaceQualitySummary | undefined): StalePreviewItems {
  return summary?.stale_records?.records.slice(0, 3) ?? [];
}

export function queueItems(queue: DiscoveryJobQueueResponse | undefined): DiscoveryJobQueueItem[] {
  return queue?.items ?? [];
}
