import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Entry, EntryFilterParams, EntryListResponse } from "@/types";

export function useEntries(params?: EntryFilterParams) {
  return useQuery<EntryListResponse>({
    queryKey: ["entries", params],
    queryFn: () => api.entries.list(params),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 10,
  });
}

interface UseEntryOptions {
  enabled?: boolean;
}

export function useEntry(id: string, options?: UseEntryOptions) {
  return useQuery<Entry>({
    queryKey: ["entries", id],
    queryFn: () => api.entries.get(id),
    staleTime: 1000 * 60 * 10,
    enabled: options?.enabled ?? true,
  });
}
