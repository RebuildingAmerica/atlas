import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Entry, EntryFilterParams, EntryListResponse } from "@/types";

interface UseEntriesOptions {
  /** Hydrate the React Query cache with this server-side payload on first render. */
  initialData?: EntryListResponse;
}

export function useEntries(params?: EntryFilterParams, options?: UseEntriesOptions) {
  return useQuery<EntryListResponse>({
    queryKey: ["entries", params],
    queryFn: () => api.entries.list(params),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 10,
    initialData: options?.initialData,
  });
}

interface UseEntryOptions {
  enabled?: boolean;
  initialData?: Entry;
}

export function useEntry(id: string, options?: UseEntryOptions) {
  return useQuery<Entry>({
    queryKey: ["entries", id],
    queryFn: () => api.entries.get(id),
    staleTime: 1000 * 60 * 10,
    enabled: options?.enabled ?? true,
    initialData: options?.initialData,
  });
}

export function useEntryBySlug(
  type: "people" | "organizations",
  slug: string,
  options?: UseEntryOptions,
) {
  return useQuery<Entry>({
    queryKey: ["entries", "by-slug", type, slug],
    queryFn: () => api.entries.getBySlug(type, slug),
    staleTime: 1000 * 60 * 10,
    enabled: (options?.enabled ?? true) && Boolean(slug),
    retry: false,
    initialData: options?.initialData,
  });
}
