/**
 * React Query hook for fetching an entry's connections.
 *
 * Returns related actors grouped by relationship type (same org,
 * co-mentioned, same issue area, same geography).
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ConnectionGroup } from "@/types";

/** Fetch and cache connections for a profile sidebar. */
export function useConnections(entryId: string) {
  return useQuery<ConnectionGroup[]>({
    queryKey: ["connections", entryId],
    queryFn: () => api.entries.getConnections(entryId),
    staleTime: 10 * 60 * 1000,
    enabled: !!entryId,
  });
}
