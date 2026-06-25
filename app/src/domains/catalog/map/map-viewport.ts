import type { MapBounds } from "@/types";
import type { SelectionAnchor } from "@/domains/catalog/map/map-selection";

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

/** Decimal places a shared coordinate is rounded to (~10m) for a tidy URL. */
const COORD_PRECISION = 4;

/** Decimal places a shared zoom is rounded to for a tidy URL. */
const ZOOM_PRECISION = 2;

/** Round a number to a fixed number of decimal places. */
function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
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
  if (search.z === undefined || search.lat === undefined || search.lng === undefined) {
    return CONUS_VIEW;
  }
  return { center: { lng: search.lng, lat: search.lat }, zoom: search.z };
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
export function boundsFromCorners(a: SelectionAnchor, b: SelectionAnchor): MapBounds {
  return {
    minLng: Math.min(a.lng, b.lng),
    minLat: Math.min(a.lat, b.lat),
    maxLng: Math.max(a.lng, b.lng),
    maxLat: Math.max(a.lat, b.lat),
  };
}
