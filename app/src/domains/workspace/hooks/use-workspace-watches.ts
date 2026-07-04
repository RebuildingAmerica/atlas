import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loadWorkspaceWatches,
  loadWorkspaceWatchStatus,
  unwatchWorkspaceResource,
  watchWorkspaceResource,
  type WorkspaceWatchCollection,
  type WorkspaceWatchInput,
  type WorkspaceWatchStatus,
} from "@/domains/workspace/server/watches";

export const WORKSPACE_WATCHES_KEY = ["workspace", "watches"] as const;

function workspaceWatchKey(input: WorkspaceWatchInput): readonly unknown[] {
  return [...WORKSPACE_WATCHES_KEY, input.resourceType, input.resourceId] as const;
}

/**
 * Fetch and cache watch status for one workspace resource.
 *
 * @param input - Resource type and id.
 * @param enabled - Whether the query should run.
 * @returns React Query result wrapping workspace watch status.
 */
export function useWorkspaceWatchStatus(input: WorkspaceWatchInput, enabled = true) {
  return useQuery<WorkspaceWatchStatus>({
    enabled,
    queryFn: () => loadWorkspaceWatchStatus({ data: input }),
    queryKey: workspaceWatchKey(input),
  });
}

/**
 * Fetch and cache the shared workspace watch list.
 *
 * @param initialData - Route-loaded watch collection.
 * @returns React Query result wrapping enriched workspace watches.
 */
export function useWorkspaceWatches(initialData: WorkspaceWatchCollection) {
  return useQuery<WorkspaceWatchCollection>({
    initialData,
    queryFn: () => loadWorkspaceWatches(),
    queryKey: WORKSPACE_WATCHES_KEY,
  });
}

/**
 * Watches a workspace resource and refreshes its status.
 */
export function useWatchWorkspaceResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: WorkspaceWatchInput) => watchWorkspaceResource({ data }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: workspaceWatchKey(variables) });
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_WATCHES_KEY });
    },
  });
}

/**
 * Unwatches a workspace resource and refreshes its status.
 */
export function useUnwatchWorkspaceResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: WorkspaceWatchInput) => unwatchWorkspaceResource({ data }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: workspaceWatchKey(variables) });
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_WATCHES_KEY });
    },
  });
}
