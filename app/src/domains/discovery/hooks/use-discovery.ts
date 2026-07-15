import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDiscoveryRun,
  listDiscoveryJobQueue,
  listDiscoveryRuns,
  startDiscoveryRun,
} from "@/domains/discovery/functions";
import type {
  DiscoveryJobQueueResponse,
  DiscoveryRun,
  DiscoveryRunListResponse,
  StartDiscoveryRequest,
} from "@rebuildingamerica/atlas-api-client";

export function discoveryRunsQueryOptions() {
  return queryOptions<DiscoveryRunListResponse>({
    queryKey: ["discovery", "runs"],
    queryFn: () => listDiscoveryRuns(),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      if (!items.some((run) => run.status === "running")) {
        return false;
      }
      const updatedAt = query.state.dataUpdatedAt;
      return Date.now() - updatedAt > 60_000 ? 10_000 : 3_000;
    },
    staleTime: 0,
  });
}

export function useDiscoveryRuns() {
  return useQuery(discoveryRunsQueryOptions());
}

export function discoveryRunQueryOptions(id: string) {
  return queryOptions<DiscoveryRun>({
    queryKey: ["discovery", "runs", id],
    queryFn: () => getDiscoveryRun({ data: { id } }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && status !== "running") {
        return false;
      }
      const updatedAt = query.state.dataUpdatedAt;
      return Date.now() - updatedAt > 60_000 ? 10_000 : 3_000;
    },
    staleTime: 0,
  });
}

export function useDiscoveryRun(id: string) {
  return useQuery(discoveryRunQueryOptions(id));
}

export function useDiscoveryJobQueue() {
  return useQuery<DiscoveryJobQueueResponse>({
    queryKey: ["discovery", "jobs"],
    queryFn: () => listDiscoveryJobQueue({ data: { limit: 10 } }),
    refetchInterval: (query) => {
      const counts = query.state.data?.status_counts;
      const activeJobs = (counts?.queued ?? 0) + (counts?.claimed ?? 0) + (counts?.running ?? 0);
      if (activeJobs === 0) {
        return false;
      }
      const updatedAt = query.state.dataUpdatedAt;
      return Date.now() - updatedAt > 60_000 ? 10_000 : 3_000;
    },
    staleTime: 0,
  });
}

export function useStartDiscovery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: StartDiscoveryRequest) => startDiscoveryRun({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["discovery", "runs"] });
    },
  });
}
