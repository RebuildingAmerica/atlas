import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Entry, EntryFilterParams, EntryListResponse, EntrySlugScope } from "@/types";

interface UseEntriesOptions {
  /** Pause the catalog query until a deliberate retry or new route load. */
  enabled?: boolean;
  /** Hydrate the React Query cache with this server-side payload on first render. */
  initialData?: EntryListResponse;
  /** Whether React Query should automatically retry failed catalog reads. */
  retry?: boolean;
}

export function useEntries(params?: EntryFilterParams, options?: UseEntriesOptions) {
  return useQuery<EntryListResponse>({
    queryKey: ["entries", params],
    queryFn: () => api.entries.list(params),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 10,
    enabled: options?.enabled ?? true,
    initialData: options?.initialData,
    retry: options?.retry ?? false,
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

export function useEntryBySlug(type: EntrySlugScope, slug: string, options?: UseEntryOptions) {
  return useQuery<Entry>({
    queryKey: ["entries", "by-slug", type, slug],
    queryFn: () => api.entries.getBySlug(type, slug),
    staleTime: 1000 * 60 * 10,
    enabled: (options?.enabled ?? true) && Boolean(slug),
    retry: false,
    initialData: options?.initialData,
  });
}
