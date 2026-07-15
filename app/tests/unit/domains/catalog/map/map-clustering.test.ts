import { describe, expect, it } from "vitest";
import {
  buildClusterIndex,
  deriveMapFeatures,
  jitterOffset,
  readLngLat,
} from "@/domains/catalog/map/map-clustering";
import type { MapPoint } from "@rebuildingamerica/atlas-api-client";
import {
  CONUS_BOUNDS,
  makePoint,
  makeRawFeature,
} from "../../../../helpers/catalog/map-clustering-harness";

describe("jitterOffset", () => {
  it("is deterministic for a given id", () => {
    const a = jitterOffset("entry-7");
    const b = jitterOffset("entry-7");
    expect(a).toEqual(b);
  });

  it("produces different offsets for different ids", () => {
    const a = jitterOffset("entry-1");
    const b = jitterOffset("entry-2");
    expect(a).not.toEqual(b);
  });

  it("stays within the configured jitter radius", () => {
    const { dLng, dLat } = jitterOffset("entry-anything");
    const magnitude = Math.hypot(dLng, dLat);
    expect(magnitude).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it("returns a zero offset for an empty id rather than guessing", () => {
    expect(jitterOffset("")).toEqual({ dLng: 0, dLat: 0 });
  });
});

describe("readLngLat", () => {
  it("reads a well-formed 2D point geometry", () => {
    expect(readLngLat(makeRawFeature([-100, 40]))).toEqual({ lng: -100, lat: 40 });
  });

  it("fails loudly on a geometry missing a coordinate rather than guessing", () => {
    expect(() => readLngLat(makeRawFeature([]))).toThrow(
      "Clustered feature is missing a coordinate.",
    );
    expect(() => readLngLat(makeRawFeature([-100]))).toThrow(
      "Clustered feature is missing a coordinate.",
    );
  });
});

describe("deriveMapFeatures", () => {
  it("returns each far-apart actor as its own individual feature", () => {
    const points: MapPoint[] = [
      makePoint({ id: "a", lng: -122, lat: 37 }),
      makePoint({ id: "b", lng: -74, lat: 40 }),
    ];
    const index = buildClusterIndex(points);
    const features = deriveMapFeatures(index, CONUS_BOUNDS, 4);

    const individuals = features.filter((f) => f.kind === "point");
    expect(individuals).toHaveLength(2);
    expect(features.some((f) => f.kind === "cluster")).toBe(false);
  });

  it("collapses many co-located actors into a single cluster at low zoom", () => {
    const points: MapPoint[] = Array.from({ length: 12 }, (_, i) =>
      makePoint({ id: `c${i}`, lng: -96.8, lat: 32.78 }),
    );
    const index = buildClusterIndex(points);
    const features = deriveMapFeatures(index, CONUS_BOUNDS, 4);

    const clusters = features.filter((f) => f.kind === "cluster");
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.kind).toBe("cluster");
    if (clusters[0]?.kind === "cluster") {
      expect(clusters[0].pointCount).toBe(12);
      expect(clusters[0].clusterId).toEqual(expect.any(Number));
    }
  });

  it("carries the actor projection through onto an individual feature", () => {
    const points: MapPoint[] = [
      makePoint({
        id: "solo",
        name: "Solo Org",
        slug: "solo-org",
        type: "person",
        trust_level: "atlas_verified",
        issue_areas: ["climate-resilience"],
        lng: -100,
        lat: 40,
      }),
    ];
    const index = buildClusterIndex(points);
    const [feature] = deriveMapFeatures(index, CONUS_BOUNDS, 6);

    expect(feature?.kind).toBe("point");
    if (feature?.kind === "point") {
      expect(feature.point.id).toBe("solo");
      expect(feature.point.name).toBe("Solo Org");
      expect(feature.lng).toBeCloseTo(-100, 1);
      expect(feature.lat).toBeCloseTo(40, 1);
    }
  });

  it("jitters two actors sharing one coordinate so they do not stack exactly", () => {
    const points: MapPoint[] = [
      makePoint({ id: "stack-1", lng: -100, lat: 40 }),
      makePoint({ id: "stack-2", lng: -100, lat: 40 }),
    ];
    const index = buildClusterIndex(points);
    // High zoom so the two separate into individual features rather than cluster.
    const features = deriveMapFeatures(index, CONUS_BOUNDS, 16);
    const individuals = features.filter((f) => f.kind === "point");
    expect(individuals).toHaveLength(2);
    const [first, second] = individuals;
    if (first?.kind === "point" && second?.kind === "point") {
      const samePlace = first.lng === second.lng && first.lat === second.lat;
      expect(samePlace).toBe(false);
    }
  });

  it("exposes the dominant issue color and trust on an individual feature", () => {
    const points: MapPoint[] = [
      makePoint({ id: "p", issue_areas: ["labor-organizing"], trust_level: "subject_verified" }),
    ];
    const index = buildClusterIndex(points);
    const [feature] = deriveMapFeatures(index, CONUS_BOUNDS, 6);
    if (feature?.kind === "point") {
      expect(feature.point.issue_areas[0]).toBe("labor-organizing");
      expect(feature.point.trust_level).toBe("subject_verified");
    }
  });
});
