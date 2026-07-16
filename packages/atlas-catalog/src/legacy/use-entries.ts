import { useQuery } from "@tanstack/react-query";
import { api } from "@rebuildingamerica/atlas-api-client";
import type {
  Entry,
  EntryFilterParams,
  EntryListResponse,
} from "@rebuildingamerica/atlas-api-client";

export function useEntries(params?: EntryFilterParams) {
  return useQuery<EntryListResponse>({
    queryKey: ["entries", params],
    queryFn: () => api.entries.list(params),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useEntry(id: string) {
  return useQuery<Entry>({
    queryKey: ["entries", id],
    queryFn: () => api.entries.get(id),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
