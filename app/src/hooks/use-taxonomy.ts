import { useQuery } from "@tanstack/react-query";
import { api } from "@rebuildingamerica/atlas-api-client";
import type { TaxonomyResponse } from "@rebuildingamerica/atlas-api-client";

export function useTaxonomy() {
  return useQuery<TaxonomyResponse>({
    queryKey: ["taxonomy"],
    queryFn: () => api.taxonomy.list(),
    staleTime: 1000 * 60 * 30, // 30 minutes
  });
}
