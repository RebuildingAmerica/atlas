/**
 * React Query hook for fetching an entry's connections.
 *
 * Returns related actors grouped by relationship type (same org,
 * co-mentioned, same issue area, same geography).
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ConnectionGroup } from "@/types";

interface UseConnectionsOptions {
  /** Hydrate the cache with a server-side payload to skip the first fetch. */
  initialData?: ConnectionGroup[];
}

/** Fetch and cache connections for a profile sidebar. */
export function useConnections(entryId: string, options?: UseConnectionsOptions) {
  return useQuery<ConnectionGroup[]>({
    queryKey: ["connections", entryId],
    queryFn: () => api.entries.getConnections(entryId),
    staleTime: 10 * 60 * 1000,
    enabled: !!entryId,
    initialData: options?.initialData,
  });
}
