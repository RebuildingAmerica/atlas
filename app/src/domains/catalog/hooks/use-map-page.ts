import { useCallback, useMemo, useState } from "react";
import { useMapPoints } from "@/domains/catalog/hooks/use-map-points";
import { flyToPlace } from "@/domains/catalog/map/map-camera";
import { mapPointParamsFor } from "@/domains/catalog/map/map-filters";
import { readViewport } from "@/domains/catalog/map/map-readout";
import type { FlyToCamera } from "@/domains/catalog/map/map-camera";
import type { ReadableMap } from "@/domains/catalog/map/map-readout";
import type { PlaceMatch } from "@/domains/catalog/map/map-place-search";
import {
  type MapSelection,
  type SelectionAnchor,
  selectActor,
  selectCluster,
} from "@/domains/catalog/map/map-selection";
import { CONUS_VIEW, viewFromSearch, viewToSearch } from "@/domains/catalog/map/map-viewport";
import {
  type BrowseFilterKey,
  type MapRouteSearch,
  buildBrowseSearch,
  hasActiveBrowseSearch,
  serializeList,
  toggleValue,
} from "@/domains/catalog/search-state";
import type { MapBounds, MapPoint, MapPointCollection } from "@/types";

/** The zoom the camera settles at after flying to a searched city. */
const CITY_FLY_ZOOM = 10;

/** The zoom the camera settles at after flying to a searched state. */
const STATE_FLY_ZOOM = 6;

/** The minimal navigate surface the page drives to update the URL search. */
export type MapNavigate = (options: {
  to: ".";
  resetScroll?: boolean;
  search:
    ((previous: Record<string, unknown>) => Record<string, unknown>) | Record<string, unknown>;
}) => void;

/** The minimal load/move event the page reads a settled viewport off of. */
export interface MapViewportEvent {
  target: ReadableMap;
}

interface UseMapPageOptions {
  /** The route's search params (filters + a possibly-shared viewport). */
  search: MapRouteSearch;
  /** Drive URL updates; the route supplies TanStack Router's `navigate`. */
  navigate: MapNavigate;
  /** The mounted map camera, or null while the WebGL surface is still loading. */
  map?: FlyToCamera | null;
  /** The SSR-seeded CONUS points, hydrated as the initial query data. */
  initialPoints?: MapPointCollection;
}

/**
 * Orchestrate the map page's viewport, filters, selection, and camera.
 *
 * This is the page's whole behavioral core, kept apart from its layout so the
 * wiring can be reasoned about and tested without a WebGL canvas. It restores
 * the camera from the shared URL, reads the live viewport off the map after
 * each settle to both fetch the dots inside it and write the camera back to the
 * URL, threads the shared browse filters into one viewport query so the map and
 * the parallel list never diverge, and owns the panel selection plus the
 * fly-to-place / fly-to-actor / recenter camera moves.
 *
 * @param options The route search, a navigate function, and seeded points.
 * @returns Everything the page renders and the handlers its chrome calls.
 */
export function useMapPage({ search, navigate, map = null, initialPoints }: UseMapPageOptions) {
  const filters = useMemo(() => buildBrowseSearch(search), [search]);
  const initialView = useMemo(() => viewFromSearch(search), [search]);

  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [zoom, setZoom] = useState(initialView.zoom);
  const [selection, setSelection] = useState<MapSelection | null>(null);

  const updateSearch = useCallback(
    (next: Record<string, unknown>) => {
      navigate({
        to: ".",
        resetScroll: false,
        search: (previous) => ({ ...previous, ...next }),
      });
    },
    [navigate],
  );

  const persistCamera = useCallback(
    (event: MapViewportEvent) => {
      const { view, bounds: nextBounds } = readViewport(event.target);
      setBounds(nextBounds);
      setZoom(view.zoom);
      updateSearch(viewToSearch(view));
    },
    [updateSearch],
  );

  const onMoveEnd = useCallback(
    (event: MapViewportEvent) => {
      persistCamera(event);
    },
    [persistCamera],
  );

  const onLoad = useCallback(
    (event: MapViewportEvent) => {
      persistCamera(event);
    },
    [persistCamera],
  );

  const params = useMemo(
    () => (bounds ? mapPointParamsFor(filters, bounds) : null),
    [bounds, filters],
  );
  const pointsQuery = useMapPoints(params, { initialData: initialPoints });
  const points = pointsQuery.data?.points ?? [];

  const onToggleFilter = useCallback(
    (key: BrowseFilterKey, value: string) => {
      updateSearch({ [key]: serializeList(toggleValue(filters[key], value)), offset: 0 });
    },
    [filters, updateSearch],
  );

  const onSelectPlace = useCallback(
    (place: PlaceMatch) => {
      const zoomTo = place.kind === "city" ? CITY_FLY_ZOOM : STATE_FLY_ZOOM;
      flyToPlace(map ?? null, place.anchor, zoomTo);
      updateSearch({
        states: place.stateCode,
        cities: place.cityKey,
        offset: 0,
      });
    },
    [map, updateSearch],
  );

  const onSelectActor = useCallback(
    (point: MapPoint) => {
      const anchor: SelectionAnchor = { lng: point.lng, lat: point.lat };
      flyToPlace(map ?? null, anchor, CITY_FLY_ZOOM);
      setSelection(selectActor(point, anchor));
    },
    [map],
  );

  const onSelectPoint = useCallback((point: MapPoint, anchor: SelectionAnchor) => {
    setSelection(selectActor(point, anchor));
  }, []);

  const onSelectCluster = useCallback(
    (members: MapPoint[], anchor: SelectionAnchor, clusterId: number) => {
      setSelection(selectCluster(members, anchor, clusterId));
    },
    [],
  );

  const onSelectMember = useCallback((point: MapPoint) => {
    setSelection(selectActor(point, { lng: point.lng, lat: point.lat }));
  }, []);

  const onClosePanel = useCallback(() => {
    setSelection(null);
  }, []);

  const onZoomOut = useCallback(() => {
    flyToPlace(map ?? null, CONUS_VIEW.center, CONUS_VIEW.zoom);
  }, [map]);

  const onClearFilters = useCallback(() => {
    navigate({ to: ".", resetScroll: false, search: { view: "map" } });
  }, [navigate]);

  return {
    filters,
    initialView,
    bounds,
    zoom,
    points,
    pointsQuery,
    selection,
    hasActiveFilters: hasActiveBrowseSearch(filters),
    onMoveEnd,
    onLoad,
    onToggleFilter,
    onSelectPlace,
    onSelectActor,
    onSelectPoint,
    onSelectCluster,
    onSelectMember,
    onClosePanel,
    onZoomOut,
    onClearFilters,
  };
}
