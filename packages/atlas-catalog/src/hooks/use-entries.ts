import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { api } from "@rebuildingamerica/atlas-api-client";
import type {
  Entry,
  EntryFilterParams,
  EntryListResponse,
  EntrySlugScope,
} from "@rebuildingamerica/atlas-api-client";

type EntryListQueryOptions = UseQueryOptions<EntryListResponse>;

interface UseEntriesOptions {
  /** Pause the catalog query until a deliberate retry or new route load. */
  enabled?: boolean;
  /** Hydrate the React Query cache with this server-side payload on first render. */
  initialData?: EntryListResponse;
  /** Whether to refetch when the browser comes back online. */
  refetchOnReconnect?: EntryListQueryOptions["refetchOnReconnect"];
  /** Whether, or for which failures, React Query retries a failed catalog read. */
  retry?: EntryListQueryOptions["retry"];
  /** How long React Query waits before each retry. */
  retryDelay?: EntryListQueryOptions["retryDelay"];
}

export function useEntries(
  params?: EntryFilterParams,
  options?: UseEntriesOptions,
) {
  return useQuery<EntryListResponse>({
    queryKey: ["entries", params],
    queryFn: () => api.entries.list(params),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 10,
    enabled: options?.enabled ?? true,
    initialData: options?.initialData,
    refetchOnReconnect: options?.refetchOnReconnect,
    retry: options?.retry ?? false,
    retryDelay: options?.retryDelay,
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
  type: EntrySlugScope,
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
