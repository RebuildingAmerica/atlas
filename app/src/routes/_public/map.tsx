import { createFileRoute } from "@tanstack/react-router";
import { MapPage, mapSearchSchema } from "@/domains/catalog";
import { buildBrowseSearch } from "@/domains/catalog/search-state";
import { loadMapPoints } from "@/domains/catalog/server/map-points";
import type { MapRouteSearch } from "@/domains/catalog/search-state";

export const Route = createFileRoute("/_public/map")({
  ssr: false,
  validateSearch: mapSearchSchema,
  loaderDeps: ({ search }: { search: MapRouteSearch }) => ({ search }),
  loader: async ({ deps }: { deps: { search: MapRouteSearch } }) => {
    const filters = buildBrowseSearch(deps.search);
    const initialPoints = await loadMapPoints({
      data: {
        query: filters.query,
        states: filters.states,
        cities: filters.cities,
        regions: filters.regions,
        issue_areas: filters.issue_areas,
        entry_types: filters.entry_types,
        source_types: filters.source_types,
      },
    });
    return { initialPoints };
  },
  component: MapRoute,
});

function MapRoute() {
  const search = Route.useSearch();
  const { initialPoints } = Route.useLoaderData();
  return <MapPage search={search} initialPoints={initialPoints} />;
}
