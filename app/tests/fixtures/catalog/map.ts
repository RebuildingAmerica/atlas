import type { BrowseSearchState } from "@/domains/catalog/search-state";
import type { MapBounds, MapPointParams } from "@/types";

/** The continental-US bounding box used across the map tests. */
export const CONUS_BOUNDS: MapBounds = {
  minLng: -125,
  minLat: 24,
  maxLng: -66.5,
  maxLat: 49.5,
};

/**
 * Build a resolved browse filter state, overriding only the facets a test cares
 * about. Mirrors the shape `buildBrowseSearch` returns so map filter wiring can
 * be exercised without round-tripping through the URL schema.
 */
export function makeBrowseSearchState(
  overrides: Partial<BrowseSearchState> = {},
): BrowseSearchState {
  return {
    query: undefined,
    view: "map",
    states: [],
    cities: [],
    regions: [],
    issue_areas: [],
    entry_types: [],
    source_types: [],
    source_patterns: [],
    offset: 0,
    ...overrides,
  };
}

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
