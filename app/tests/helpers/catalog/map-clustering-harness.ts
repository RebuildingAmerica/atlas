import type { MapBounds, MapPoint } from "@/types";
import type { RawClusterFeature } from "@/domains/catalog/map/map-clustering";

/** A whole-CONUS viewport so a tiny fixture isn't clipped out by the bbox. */
export const CONUS_BOUNDS: MapBounds = {
  minLng: -125,
  minLat: 24,
  maxLng: -66.5,
  maxLat: 49.5,
};

/** Build a map point with sensible defaults, overriding only what a test cares about. */
export function makePoint(overrides: Partial<MapPoint> & Pick<MapPoint, "id">): MapPoint {
  return {
    name: `Actor ${overrides.id}`,
    type: "organization",
    slug: `actor-${overrides.id}`,
    lat: 40,
    lng: -100,
    issue_areas: ["housing-affordability"],
    trust_level: "corroborated",
    ...overrides,
  };
}

/** Build a raw supercluster point feature with the given (possibly malformed) coordinates. */
export function makeRawFeature(coordinates: number[]): RawClusterFeature {
  return {
    type: "Feature",
    properties: { point: makePoint({ id: "raw" }) },
    geometry: { type: "Point", coordinates },
  };
}
