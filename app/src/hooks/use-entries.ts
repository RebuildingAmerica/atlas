import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Entry, EntryFilterParams, EntryListResponse } from "@/types";

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
