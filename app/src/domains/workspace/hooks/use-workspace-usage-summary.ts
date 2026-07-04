import { useQuery } from "@tanstack/react-query";
import {
  loadWorkspaceUsageSummary,
  type WorkspaceUsageSummary,
} from "@/domains/workspace/server/usage-summary";

export const WORKSPACE_USAGE_SUMMARY_KEY = ["workspace", "usage-summary"] as const;

export function useWorkspaceUsageSummary(enabled: boolean, workspaceId: string | null) {
  return useQuery<WorkspaceUsageSummary>({
    enabled: enabled && workspaceId !== null,
    queryFn: () => loadWorkspaceUsageSummary(),
    queryKey: [...WORKSPACE_USAGE_SUMMARY_KEY, workspaceId],
  });
}
