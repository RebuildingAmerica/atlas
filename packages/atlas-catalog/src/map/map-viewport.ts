import type { MapBounds } from "@rebuildingamerica/atlas-api-client";
import type { SelectionAnchor } from "@rebuildingamerica/atlas-catalog/map/map-selection";

/** A camera position: where the map is centered and how far it is zoomed in. */
export interface MapView {
  center: SelectionAnchor;
  zoom: number;
}

/** The viewport params a shared `/map` URL carries to restore the camera. */
export interface ViewportSearch {
  z?: number;
  lat?: number;
  lng?: number;
}

/**
 * The continental-US framing the map opens on when no viewport is shared.
 *
 * A center over the lower 48 at a zoom that comfortably frames the country, so
 * a cold visit lands on "America," matching the basemap's initial bounds.
 */
export const CONUS_VIEW: MapView = {
  center: { lng: -96, lat: 38.5 },
  zoom: 3.4,
};

/**
 * The continental-US bounding box the first `/map` data load uses.
 *
 * Kept beside the opening camera so the route loader, hook, and marker layer
 * agree on the country-sized viewport available before MapLibre reports live
 * bounds.
 */
export const CONUS_BBOX_BOUNDS: MapBounds = {
  minLng: -125,
  minLat: 24,
  maxLng: -66.5,
  maxLat: 49.5,
};

/** Decimal places a shared coordinate is rounded to (~10m) for a tidy URL. */
const COORD_PRECISION = 4;

/** Decimal places a shared zoom is rounded to for a tidy URL. */
const ZOOM_PRECISION = 2;
const MERCATOR_TILE_SIZE_PX = 512;
const INITIAL_VIEWPORT_WIDTH_PX = 1024;
const INITIAL_VIEWPORT_HEIGHT_PX = 768;
const WEB_MERCATOR_MAX_LAT = 85.05112878;

/** Round a number to a fixed number of decimal places. */
function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function worldSize(zoom: number): number {
  return MERCATOR_TILE_SIZE_PX * 2 ** Math.max(0, zoom);
}

function lngToWorldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * worldSize(zoom);
}

function latToWorldY(lat: number, zoom: number): number {
  const clamped = clamp(lat, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT);
  const sin = Math.sin((clamped * Math.PI) / 180);
  return (
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize(zoom)
  );
}

function worldXToLng(x: number, zoom: number): number {
  return (x / worldSize(zoom)) * 360 - 180;
}

function worldYToLat(y: number, zoom: number): number {
  const value = Math.PI - (2 * Math.PI * y) / worldSize(zoom);
  return (
    (180 / Math.PI) * Math.atan(0.5 * (Math.exp(value) - Math.exp(-value)))
  );
}

/**
 * Restore the camera from a `/map` URL's viewport params.
 *
 * A complete `z/lat/lng` triple restores the exact camera a link was shared at;
 * anything missing falls back to the whole-country view rather than guessing a
 * partial position that would drop a visitor somewhere arbitrary.
 *
 * @param search The route's viewport search params.
 * @returns The camera to open the map at.
 */
export function viewFromSearch(search: ViewportSearch): MapView {
  if (
    search.z === undefined ||
    search.lat === undefined ||
    search.lng === undefined
  ) {
    return CONUS_VIEW;
  }
  return { center: { lng: search.lng, lat: search.lat }, zoom: search.z };
}

export function boundsFromView(view: MapView): MapBounds {
  const centerX = lngToWorldX(view.center.lng, view.zoom);
  const centerY = latToWorldY(view.center.lat, view.zoom);
  const west = worldXToLng(centerX - INITIAL_VIEWPORT_WIDTH_PX / 2, view.zoom);
  const east = worldXToLng(centerX + INITIAL_VIEWPORT_WIDTH_PX / 2, view.zoom);
  const north = worldYToLat(
    centerY - INITIAL_VIEWPORT_HEIGHT_PX / 2,
    view.zoom,
  );
  const south = worldYToLat(
    centerY + INITIAL_VIEWPORT_HEIGHT_PX / 2,
    view.zoom,
  );
  return boundsFromCorners(
    { lng: clamp(west, -180, 180), lat: clamp(south, -90, 90) },
    { lng: clamp(east, -180, 180), lat: clamp(north, -90, 90) },
  );
}

export function boundsFromSearch(search: ViewportSearch): MapBounds {
  if (
    search.z === undefined ||
    search.lat === undefined ||
    search.lng === undefined
  ) {
    return CONUS_BBOX_BOUNDS;
  }
  return boundsFromView(viewFromSearch(search));
}

/**
 * Compress the live camera into a compact, shareable search patch.
 *
 * Coordinates and zoom are rounded so a pan writes a tidy URL (and so trivially
 * different cameras collapse onto the same history entry) while still restoring
 * to within a few meters.
 *
 * @param view The current camera.
 * @returns The viewport search params to merge into the URL.
 */
export function viewToSearch(view: MapView): Required<ViewportSearch> {
  return {
    lng: round(view.center.lng, COORD_PRECISION),
    lat: round(view.center.lat, COORD_PRECISION),
    z: round(view.zoom, ZOOM_PRECISION),
  };
}

/**
 * Order an unordered pair of corners into a min/max bounding box.
 *
 * MapLibre's `getBounds()` exposes south-west and north-east corners; this
 * normalizes any two corners into the `{minLng, minLat, maxLng, maxLat}` shape
 * the viewport query expects, so the caller never has to assume an ordering.
 *
 * @param a One corner of the viewport.
 * @param b The opposite corner of the viewport.
 * @returns The normalized bounding box.
 */
export function boundsFromCorners(
  a: SelectionAnchor,
  b: SelectionAnchor,
): MapBounds {
  return {
    minLng: Math.min(a.lng, b.lng),
    minLat: Math.min(a.lat, b.lat),
    maxLng: Math.max(a.lng, b.lng),
    maxLat: Math.max(a.lat, b.lat),
  };
}
