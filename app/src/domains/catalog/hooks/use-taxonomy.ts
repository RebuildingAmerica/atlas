import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TaxonomyResponse } from "@/types";

interface UseTaxonomyOptions {
  /** Hydrate the cache with a server-side payload to skip the first fetch. */
  initialData?: TaxonomyResponse;
}

export function useTaxonomy(options?: UseTaxonomyOptions) {
  return useQuery<TaxonomyResponse>({
    queryKey: ["taxonomy"],
    queryFn: () => api.taxonomy.list(),
    staleTime: 1000 * 60 * 60 * 24,
    initialData: options?.initialData,
  });
}
