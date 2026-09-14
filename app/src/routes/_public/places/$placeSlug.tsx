import { createFileRoute } from "@tanstack/react-router";
import { buildPlaceRouteHead, loadPlaceRouteOrDegrade } from "@/domains/catalog/pages/place-route";
import { PlaceRoutePage } from "@/domains/catalog/pages/place-route-page";

export const Route = createFileRoute("/_public/places/$placeSlug")({
  loader: async ({ params }) => loadPlaceRouteOrDegrade(params),
  head: ({ loaderData, params }) => buildPlaceRouteHead(loaderData, `/places/${params.placeSlug}`),
  component: PlaceRoute,
});

function PlaceRoute() {
  return <PlaceRoutePage loaderData={Route.useLoaderData()} params={Route.useParams()} />;
}
