import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "@rebuildingamerica/atlas-api-client";
import type { TaxonomyResponse } from "@rebuildingamerica/atlas-api-client";

export function taxonomyQueryOptions() {
  return queryOptions<TaxonomyResponse>({
    queryKey: ["taxonomy"],
    queryFn: () => api.taxonomy.list(),
    staleTime: 1000 * 60 * 60 * 24,
  });
}

export function useTaxonomy() {
  return useQuery(taxonomyQueryOptions());
}
