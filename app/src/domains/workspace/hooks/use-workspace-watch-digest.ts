import { useQuery } from "@tanstack/react-query";
import {
  loadWorkspaceWatchDigest,
  type WorkspaceWatchDigest,
} from "@/domains/workspace/server/watch-digest";

export const WORKSPACE_WATCH_DIGEST_KEY = ["workspace", "watch-digest"] as const;

/**
 * Fetch and cache watch digest events for the active workspace.
 *
 * @param limit - Maximum number of digest rows to return.
 * @returns React Query result wrapping workspace digest rows.
 */
export function useWorkspaceWatchDigest(limit = 50) {
  return useQuery<WorkspaceWatchDigest>({
    queryFn: () => loadWorkspaceWatchDigest({ data: { limit } }),
    queryKey: [...WORKSPACE_WATCH_DIGEST_KEY, limit] as const,
  });
}
