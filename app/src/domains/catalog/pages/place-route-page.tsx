import { useDegradedRouteData } from "@/platform/routes/use-degraded-route-data";
import type { PlacePageData } from "@rebuildingamerica/atlas-api-client";
import { PlacePage } from "./place-page";
import { PlacePageSkeleton } from "./place-page-skeleton";
import {
  loadPlaceRoute,
  placePageQueryKey,
  type PlaceRouteOptions,
  type PlaceRouteParams,
} from "./place-route";

interface PlaceRoutePageProps {
  /** What the loader returned: the place, or `undefined` when the API failed. */
  loaderData: PlacePageData | undefined;
  options?: PlaceRouteOptions;
  params: PlaceRouteParams;
}

interface DegradedPlacePageProps {
  options: PlaceRouteOptions;
  params: PlaceRouteParams;
}

function DegradedPlacePage({ options, params }: DegradedPlacePageProps) {
  const data = useDegradedRouteData({
    queryFn: () => loadPlaceRoute(params, options),
    queryKey: placePageQueryKey(params, options),
  });

  return data ? <PlacePage data={data} /> : <PlacePageSkeleton />;
}

/**
 * The component every place route renders.
 *
 * The browser fetch lives in its own component so a page the server already
 * loaded never mounts a query it has no use for.
 */
export function PlaceRoutePage({ loaderData, options = {}, params }: PlaceRoutePageProps) {
  if (loaderData) {
    return <PlacePage data={loaderData} />;
  }
  return <DegradedPlacePage options={options} params={params} />;
}
