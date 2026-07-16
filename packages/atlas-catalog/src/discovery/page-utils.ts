import type {
  DiscoveryJobProgress,
  DiscoveryJobQueueItem,
  DiscoveryJobQueueResponse,
} from "@rebuildingamerica/atlas-api-client";

export function prefilledIssueAreas(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((issueArea) => issueArea.trim())
    .filter(Boolean);
}

export function formatQueueStatus(status: string): string {
  return status === "claimed" ? "running" : status;
}

export function formatProgressStep(
  progress: DiscoveryJobProgress | null | undefined,
): string | null {
  const rawStep = progress?.step;
  return typeof rawStep === "string" && rawStep.length > 0
    ? rawStep.replaceAll("_", " ")
    : null;
}

export function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function queueItems(queue: DiscoveryJobQueueResponse | undefined): DiscoveryJobQueueItem[] {
  return queue?.items ?? [];
}
