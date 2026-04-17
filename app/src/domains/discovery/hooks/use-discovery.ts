import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDiscoveryRun,
  listDiscoveryRuns,
  startDiscoveryRun,
} from "@/domains/discovery/functions";
import type { DiscoveryRun, DiscoveryRunListResponse, StartDiscoveryRequest } from "@/types";

export function useDiscoveryRuns() {
  return useQuery<DiscoveryRunListResponse>({
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

export function useDiscoveryRun(id: string) {
  return useQuery<DiscoveryRun>({
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

export function useStartDiscovery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: StartDiscoveryRequest) => startDiscoveryRun({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["discovery", "runs"] });
    },
  });
}
