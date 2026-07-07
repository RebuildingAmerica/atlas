import { createFileRoute } from "@tanstack/react-router";
import { MapPage } from "@/domains/catalog/components/map/map-page";
import { buildBrowseSearch } from "@/domains/catalog/search-state";
import { loadMapPoints } from "@/domains/catalog/server/map-points";
import { isRecoverablePublicLoaderError } from "@/platform/routes/public-loader-errors";
import { buildPageHead } from "@/platform/seo";
import { mapSearchSchema, type MapRouteSearch } from "@/domains/catalog/search-state";

export const Route = createFileRoute("/_public/map")({
  ssr: false,
  validateSearch: mapSearchSchema,
  head: () =>
    buildPageHead({
      title: "Civic Map | Atlas",
      description: "Map people and groups by place, issue, and source.",
      path: "/map",
    }),
  loaderDeps: ({ search }: { search: MapRouteSearch }) => ({ search }),
  loader: async ({ deps }: { deps: { search: MapRouteSearch } }) => {
    const filters = buildBrowseSearch(deps.search);
    try {
      const initialPoints = await loadMapPoints({
        data: {
          query: filters.query,
          z: deps.search.z,
          lat: deps.search.lat,
          lng: deps.search.lng,
          states: filters.states,
          cities: filters.cities,
          regions: filters.regions,
          issue_areas: filters.issue_areas,
          entry_types: filters.entry_types,
          source_types: filters.source_types,
          source_patterns: filters.source_patterns,
        },
      });
      return { initialPoints };
    } catch (error) {
      if (isRecoverablePublicLoaderError(error)) {
        return { initialPointsLoadFailed: true };
      }
      throw error;
    }
  },
  component: MapRoute,
});

function MapRoute() {
  const search = Route.useSearch();
  const { initialPoints, initialPointsLoadFailed } = Route.useLoaderData();
  return (
    <MapPage
      search={search}
      initialPoints={initialPoints}
      initialPointsLoadFailed={initialPointsLoadFailed}
    />
  );
}
