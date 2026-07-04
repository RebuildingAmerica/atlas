import { useQuery } from "@tanstack/react-query";
import {
  loadWorkspaceQualitySummary,
  type WorkspaceQualitySummary,
} from "@/domains/workspace/server/quality-summary";

export const WORKSPACE_QUALITY_SUMMARY_KEY = ["workspace", "quality-summary"] as const;

/**
 * Fetch and cache the active workspace ingestion quality summary.
 *
 * @returns React Query result wrapping source coverage and quality-risk signals.
 */
export function useWorkspaceQualitySummary() {
  return useQuery<WorkspaceQualitySummary>({
    queryFn: () => loadWorkspaceQualitySummary(),
    queryKey: WORKSPACE_QUALITY_SUMMARY_KEY,
  });
}
