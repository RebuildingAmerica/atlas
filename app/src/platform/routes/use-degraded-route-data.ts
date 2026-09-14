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
 * The route renders this only after `loadOrDegrade` returned nothing, so the
 * page is already on screen with placeholders. The fetch retries until the
 * API answers, and the caller keeps showing placeholders meanwhile.
 *
 * @param options - The cache key and the loader's data call.
 * @returns The data once it arrives, or `undefined` while it is still coming.
 */
export function useDegradedRouteData<T>({ queryKey, queryFn }: DegradedRouteDataOptions<T>) {
  const query = useQuery({ ...PUBLIC_QUERY_RETRY_OPTIONS, queryFn, queryKey });

  if (isNotFound(query.error)) {
    // Only the root route has a notFoundComponent. A not-found thrown while
    // rendering gets stamped with the throwing route's id on its way up, and
    // the root boundary rethrows any id but its own, so name the root here.
    notFound({ routeId: rootRouteId, throw: true });
  }

  return query.data;
}
