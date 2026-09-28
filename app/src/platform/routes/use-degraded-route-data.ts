import { useQuery, type QueryKey } from "@tanstack/react-query";
import { isNotFound, notFound, rootRouteId } from "@tanstack/react-router";
import { PUBLIC_QUERY_RETRY_OPTIONS } from "@/platform/query/public-query-retry";

export interface DegradedRouteDataOptions<T> {
  /** Cache key for the data the loader failed to fetch. */
  queryKey: QueryKey;
  /** The same call the loader made. */
  queryFn: () => Promise<T>;
}

/**
 * Fetches, in the browser, the data a public route's loader could not.
 *
 * The route renders this only after `loadOrDegrade` returned nothing. A
 * transient failure gets one automatic retry; callers can then show a manual
 * recovery action rather than hold the placeholder indefinitely.
 *
 * @param options - The cache key and the loader's data call.
 * @returns The data and recovery state for the caller's content area.
 */
export function useDegradedRouteData<T>({ queryKey, queryFn }: DegradedRouteDataOptions<T>) {
  const query = useQuery({ ...PUBLIC_QUERY_RETRY_OPTIONS, queryFn, queryKey });

  if (isNotFound(query.error)) {
    // Only the root route has a notFoundComponent. A not-found thrown while
    // rendering gets stamped with the throwing route's id on its way up, and
    // the root boundary rethrows any id but its own, so name the root here.
    notFound({ routeId: rootRouteId, throw: true });
  }

  return { data: query.data, isError: query.isError, refetch: query.refetch };
}
