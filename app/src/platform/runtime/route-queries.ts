/**
 * Awaits route queries without letting their payload become loader data.
 *
 * Route loaders warm `context.queryClient` so the server render paints from
 * real data, and the router ships that cache to the browser (see `getRouter`)
 * so the page survives hydration. Resolving to `void` is the whole point: a
 * loader that returned the records would serialise them into the HTML a second
 * time, once as loader data and once as the dehydrated cache. Wrapping the
 * `ensureQueryData` calls in this helper makes that contract hard to break by
 * accident, and keeps each call's own generics intact.
 *
 * @param queries - In-flight `ensureQueryData` calls for the route.
 * @returns Nothing, once every query has settled.
 */
export async function warmRouteQueries(...queries: Promise<unknown>[]): Promise<void> {
  await Promise.all(queries);
}
