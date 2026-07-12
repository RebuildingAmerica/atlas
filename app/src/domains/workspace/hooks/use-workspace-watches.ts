import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
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
const WORKSPACE_WATCH_STATUS_KEY = [...WORKSPACE_WATCHES_KEY, "status"] as const;

function workspaceWatchKey(
  input: WorkspaceWatchInput,
  workspaceId: string | null,
): readonly unknown[] {
  return [
    ...WORKSPACE_WATCH_STATUS_KEY,
    workspaceId,
    input.resourceType,
    input.resourceId,
  ] as const;
}

/**
 * Fetch and cache watch status for one workspace resource.
 *
 * @param input - Resource type and id.
 * @param enabled - Whether the query should run.
 * @param workspaceId - Active workspace id that owns this private watch status.
 * @returns React Query result wrapping workspace watch status.
 */
export function useWorkspaceWatchStatus(
  input: WorkspaceWatchInput,
  enabled = true,
  workspaceId: string | null = null,
) {
  return useQuery<WorkspaceWatchStatus>({
    enabled: enabled && workspaceId !== null,
    queryFn: () => loadWorkspaceWatchStatus({ data: input }),
    queryKey: workspaceWatchKey(input, workspaceId),
  });
}

export function workspaceWatchesQueryOptions() {
  return queryOptions<WorkspaceWatchCollection>({
    queryFn: () => loadWorkspaceWatches(),
    queryKey: [...WORKSPACE_WATCHES_KEY, "list"],
  });
}

/**
 * Fetch and cache the shared workspace watch list.
 *
 * @returns React Query result wrapping enriched workspace watches.
 */
export function useWorkspaceWatches() {
  return useSuspenseQuery(workspaceWatchesQueryOptions());
}

export function useWorkspaceWatchesSnapshot(enabled: boolean, workspaceId: string | null) {
  return useQuery<WorkspaceWatchCollection>({
    enabled: enabled && workspaceId !== null,
    queryFn: () => loadWorkspaceWatches(),
    queryKey: [...WORKSPACE_WATCHES_KEY, "snapshot", workspaceId],
  });
}

/**
 * Watches a workspace resource and refreshes its status.
 */
export function useWatchWorkspaceResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: WorkspaceWatchInput) => watchWorkspaceResource({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_WATCH_STATUS_KEY });
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_WATCH_STATUS_KEY });
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_WATCHES_KEY });
    },
  });
}
