import { boundsFromCorners } from "@rebuildingamerica/atlas-catalog/map/map-viewport";
import type { MapView } from "@rebuildingamerica/atlas-catalog/map/map-viewport";
import type { SelectionAnchor } from "@rebuildingamerica/atlas-catalog/map/map-selection";
import type { MapBounds } from "@rebuildingamerica/atlas-api-client";

/** A MapLibre bounds object, narrowed to the corners the readout needs. */
export interface ReadableBounds {
  getSouthWest: () => SelectionAnchor;
  getNorthEast: () => SelectionAnchor;
}

/** The MapLibre map surface the viewport readout reads, nothing more. */
export interface ReadableMap {
  getCenter: () => SelectionAnchor;
  getZoom: () => number;
  getBounds: () => ReadableBounds;
}

/** The camera and bounding box read from the map in one snapshot. */
export interface ViewportReadout {
  view: MapView;
  bounds: MapBounds;
}

/**
 * Read the current camera and bounding box off a map instance.
 *
 * Called after a pan or zoom settles so the page can both fetch the dots inside
 * the new viewport and write the camera back to the URL. Bundling the read into
 * one snapshot keeps the page from querying the map three separate times for
 * three pieces of one moment.
 *
 * @param map The MapLibre map.
 * @returns The camera (center + zoom) and the normalized bounding box.
 */
export function readViewport(map: ReadableMap): ViewportReadout {
  const bounds = map.getBounds();
  return {
    view: { center: map.getCenter(), zoom: map.getZoom() },
    bounds: boundsFromCorners(bounds.getSouthWest(), bounds.getNorthEast()),
  };
}
