/**
 * React Query hook for an entry's ranked connection network.
 *
 * Server routes seed this via `initialData` so the network renders in the SSR
 * HTML; the client only revalidates.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@rebuildingamerica/atlas-api-client";
import type { ConnectionNetwork } from "@rebuildingamerica/atlas-api-client";

interface UseConnectionsOptions {
  /** Hydrate the cache with a server-side payload to skip the first fetch. */
  initialData?: ConnectionNetwork;
}

/** Fetch and cache the ranked connection network for a profile. */
export function useConnections(
  entryId: string,
  options?: UseConnectionsOptions,
) {
  return useQuery<ConnectionNetwork>({
    queryKey: ["connections", entryId],
    queryFn: () => api.entries.getConnections(entryId),
    staleTime: 10 * 60 * 1000,
    enabled: !!entryId,
    initialData: options?.initialData,
  });
}
