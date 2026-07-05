import { createFileRoute } from "@tanstack/react-router";
import { PlacePage } from "@/domains/catalog/pages/place-page";
import { buildPlaceRouteHead, loadPlaceRoute } from "@/domains/catalog/pages/place-route";

export const Route = createFileRoute("/_public/places/neighborhoods/$placeSlug")({
  loader: async ({ params }) => loadPlaceRoute(params, { kind: "neighborhood" }),
  head: ({ loaderData, params }) =>
    buildPlaceRouteHead(loaderData, `/places/neighborhoods/${params.placeSlug}`),
  component: PlaceRoute,
});

function PlaceRoute() {
  const data = Route.useLoaderData();
  return <PlacePage data={data} />;
}
