import type { MapBounds, MapPointParams } from "@/types";

/** The continental-US bounding box used across the map tests. */
export const CONUS_BOUNDS: MapBounds = {
  minLng: -125,
  minLat: 24,
  maxLng: -66.5,
  maxLat: 49.5,
};

/**
 * A bounding box with sub-grid noise on every edge, used to prove the query key
 * rounds micro-pans onto a stable cache entry.
 */
export const JITTERED_BOUNDS: MapBounds = {
  minLng: -125.004,
  minLat: 24.006,
  maxLng: -66.498,
  maxLat: 49.503,
};

/** A baseline viewport query: the jittered CONUS box filtered to housing. */
export const HOUSING_VIEWPORT: MapPointParams = {
  bounds: JITTERED_BOUNDS,
  issue_areas: ["housing_affordability"],
};
