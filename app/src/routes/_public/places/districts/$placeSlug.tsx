import { createFileRoute } from "@tanstack/react-router";
import {
  buildPlaceRouteHead,
  loadPlaceRouteOrDegrade,
  type PlaceRouteOptions,
} from "@/domains/catalog/pages/place-route";
import { PlaceRoutePage } from "@/domains/catalog/pages/place-route-page";

const PLACE_ROUTE_OPTIONS: PlaceRouteOptions = { kind: "district" };

export const Route = createFileRoute("/_public/places/districts/$placeSlug")({
  loader: async ({ params }) => loadPlaceRouteOrDegrade(params, PLACE_ROUTE_OPTIONS),
  head: ({ loaderData, params }) =>
    buildPlaceRouteHead(loaderData, `/places/districts/${params.placeSlug}`),
  component: PlaceRoute,
});

function PlaceRoute() {
  return (
    <PlaceRoutePage
      loaderData={Route.useLoaderData()}
      options={PLACE_ROUTE_OPTIONS}
      params={Route.useParams()}
    />
  );
}
