import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rebuildingamerica/atlas-api-client";
import type {
  DiscoveryRun,
  DiscoveryRunListResponse,
  StartDiscoveryRequest,
} from "@rebuildingamerica/atlas-api-client";

export function useDiscoveryRuns() {
  return useQuery<DiscoveryRunListResponse>({
    queryKey: ["discovery", "runs"],
    queryFn: () => api.discovery.list(),
    refetchInterval: 3000, // Refetch every 3 seconds
    staleTime: 0,
  });
}

export function useDiscoveryRun(id: string) {
  return useQuery<DiscoveryRun>({
    queryKey: ["discovery", "runs", id],
    queryFn: () => api.discovery.get(id),
    refetchInterval: 3000, // Refetch every 3 seconds
    staleTime: 0,
  });
}

export function useStartDiscovery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: StartDiscoveryRequest) => api.discovery.start(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["discovery", "runs"] });
    },
  });
}
