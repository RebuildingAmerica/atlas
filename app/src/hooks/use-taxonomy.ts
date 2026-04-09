import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TaxonomyResponse } from "@/types";

export function useTaxonomy() {
  return useQuery<TaxonomyResponse>({
    queryKey: ["taxonomy"],
    queryFn: () => api.taxonomy.list(),
    staleTime: 1000 * 60 * 30, // 30 minutes
  });
}
