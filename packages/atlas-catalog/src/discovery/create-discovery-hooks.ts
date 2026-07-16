import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DiscoveryJobQueueResponse,
  DiscoveryRun,
  DiscoveryRunListResponse,
  StartDiscoveryRequest,
} from "@rebuildingamerica/atlas-api-client";

export interface DiscoveryClient {
  getRun(id: string): Promise<DiscoveryRun>;
  listJobQueue(limit: number): Promise<DiscoveryJobQueueResponse>;
  listRuns(): Promise<DiscoveryRunListResponse>;
  startRun(data: StartDiscoveryRequest): Promise<DiscoveryRun>;
}

function runningInterval(updatedAt: number, running: boolean): false | number {
  if (!running) {
    return false;
  }

  return Date.now() - updatedAt > 60_000 ? 10_000 : 3_000;
}

/**
 * Creates discovery query behavior around an application-provided transport.
 * The app owns authenticated server calls; catalog owns polling and cache policy.
 */
export function createDiscoveryHooks(client: DiscoveryClient) {
  function discoveryRunsQueryOptions() {
    return queryOptions<DiscoveryRunListResponse>({
      queryKey: ["discovery", "runs"],
      queryFn: () => client.listRuns(),
      refetchInterval: (query) =>
        runningInterval(
          query.state.dataUpdatedAt,
          (query.state.data?.items ?? []).some((run) => run.status === "running"),
        ),
      staleTime: 0,
    });
  }

  function discoveryRunQueryOptions(id: string) {
    return queryOptions<DiscoveryRun>({
      queryKey: ["discovery", "runs", id],
      queryFn: () => client.getRun(id),
      refetchInterval: (query) =>
        runningInterval(
          query.state.dataUpdatedAt,
          query.state.data?.status === undefined || query.state.data.status === "running",
        ),
      staleTime: 0,
    });
  }

  function useDiscoveryRuns() {
    return useQuery(discoveryRunsQueryOptions());
  }

  function useDiscoveryRun(id: string) {
    return useQuery(discoveryRunQueryOptions(id));
  }

  function useDiscoveryJobQueue() {
    return useQuery<DiscoveryJobQueueResponse>({
      queryKey: ["discovery", "jobs"],
      queryFn: () => client.listJobQueue(10),
      refetchInterval: (query) => {
        const counts = query.state.data?.status_counts;
        return runningInterval(
          query.state.dataUpdatedAt,
          (counts?.queued ?? 0) + (counts?.claimed ?? 0) + (counts?.running ?? 0) > 0,
        );
      },
      staleTime: 0,
    });
  }

  function useStartDiscovery() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: (data: StartDiscoveryRequest) => client.startRun(data),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["discovery", "runs"] });
      },
    });
  }

  return {
    discoveryRunQueryOptions,
    discoveryRunsQueryOptions,
    useDiscoveryJobQueue,
    useDiscoveryRun,
    useDiscoveryRuns,
    useStartDiscovery,
  };
}
