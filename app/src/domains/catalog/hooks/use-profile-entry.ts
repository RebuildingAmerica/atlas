import { useQuery } from "@tanstack/react-query";
import {
  loadEntryBySlugAny,
  loadProfileBySlug,
} from "@/domains/catalog/server/profiles/profile-loaders";
import { PUBLIC_QUERY_RETRY_OPTIONS } from "@/platform/query/public-query-retry";
import { useDegradedRouteData } from "@/platform/routes/use-degraded-route-data";
import { api } from "@rebuildingamerica/atlas-api-client";
import type { ConnectionNetwork, Entry, EntrySlugScope } from "@rebuildingamerica/atlas-api-client";

/**
 * Which profile a public page needs. `any` resolves a slug that may name
 * either a person or an organization, as the claim and feedback pages do.
 */
export type ProfileEntryScope = EntrySlugScope | "any";

/** The slug a public page was opened with, and where to look it up. */
export interface ProfileEntryLookup {
  scope: ProfileEntryScope;
  slug: string;
}

const PROFILE_STALE_TIME_MS = 10 * 60 * 1000;

/**
 * Cache key for a profile looked up by slug.
 *
 * A scoped lookup shares `useEntryBySlug`'s key because both store the same
 * `Entry`, so a profile fetched by either one is not fetched again.
 *
 * @param lookup - The slug and scope.
 * @returns The React Query key.
 */
export function profileEntryQueryKey(lookup: ProfileEntryLookup): readonly unknown[] {
  if (lookup.scope === "any") {
    return ["entries", "by-slug-any", lookup.slug];
  }
  return ["entries", "by-slug", lookup.scope, lookup.slug];
}

/**
 * Fetches a profile in the browser after its route loader could not.
 *
 * It calls the loader's own server functions so a missing record comes back
 * as the same router `notFound` the loader throws, and so the request reaches
 * the API the way a client-side navigation already does.
 *
 * @param lookup - The slug and scope.
 * @returns The entry.
 */
function fetchProfileEntry(lookup: ProfileEntryLookup): Promise<Entry> {
  if (lookup.scope === "any") {
    return loadEntryBySlugAny({ data: { slug: lookup.slug } });
  }
  return loadProfileBySlug({ data: { type: lookup.scope, slug: lookup.slug } });
}

/**
 * Loads a profile whose route loader came back empty.
 *
 * It retries until the API answers and throws the router's not-found when
 * the record does not exist, so the caller only has to show a placeholder
 * while the result is `undefined`.
 *
 * @param lookup - The slug and scope.
 * @returns The entry once it arrives, or `undefined` while it is still coming.
 */
export function useProfileEntry(lookup: ProfileEntryLookup): Entry | undefined {
  return useDegradedRouteData({
    queryKey: profileEntryQueryKey(lookup),
    queryFn: () => fetchProfileEntry(lookup),
  });
}

/**
 * Loads a profile's connection network, retrying until the API answers.
 *
 * `useConnections` gives up after the app's single default retry, and the
 * network section then tells the visitor no connections exist. This shares
 * its cache key and keeps retrying, so the section holds its loading state
 * through an outage instead.
 *
 * @param entryId - The profile's entry id.
 * @param initialData - A server-rendered network, when a loader supplied one.
 * @returns The React Query result.
 */
export function useProfileConnections(entryId: string, initialData?: ConnectionNetwork) {
  return useQuery<ConnectionNetwork>({
    ...PUBLIC_QUERY_RETRY_OPTIONS,
    queryKey: ["connections", entryId],
    queryFn: () => api.entries.getConnections(entryId),
    initialData,
    staleTime: PROFILE_STALE_TIME_MS,
  });
}
