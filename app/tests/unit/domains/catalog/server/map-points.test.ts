import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONUS_BBOX_BOUNDS, loadMapPoints } from "@/domains/catalog/server/map-points";
import type { MapPointCollection, MapPointParams } from "@rebuildingamerica/atlas-api-client";

const mocks = vi.hoisted(() => ({
  mapPoints: vi.fn<(params: MapPointParams) => Promise<MapPointCollection>>(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: { entries: { mapPoints: mocks.mapPoints } },
}));

beforeEach(() => {
  mocks.mapPoints.mockReset();
});

describe("loadMapPoints", () => {
  it("seeds the continental-US viewport with the matching browse filters", async () => {
    const collection = { points: [], total: 0, capped: false };
    mocks.mapPoints.mockResolvedValue(collection);

    const result = await loadMapPoints({
      data: {
        issue_areas: ["housing-affordability"],
        states: ["TX"],
        source_patterns: ["multi_source"],
      },
    });

    expect(result).toBe(collection);
    expect(mocks.mapPoints).toHaveBeenCalledWith({
      bounds: CONUS_BBOX_BOUNDS,
      query: undefined,
      states: ["TX"],
      cities: [],
      regions: [],
      issue_areas: ["housing-affordability"],
      entry_types: [],
      source_types: [],
      source_patterns: ["multi_source"],
    });
  });

  it("seeds an unfiltered country when no filters are supplied", async () => {
    mocks.mapPoints.mockResolvedValue({ points: [], total: 0, capped: false });
    await loadMapPoints({ data: {} });
    expect(mocks.mapPoints).toHaveBeenCalledWith({
      bounds: CONUS_BBOX_BOUNDS,
      query: undefined,
      states: [],
      cities: [],
      regions: [],
      issue_areas: [],
      entry_types: [],
      source_types: [],
      source_patterns: [],
    });
  });

  it("carries a non-empty query through but drops a blank one", async () => {
    mocks.mapPoints.mockResolvedValue({ points: [], total: 0, capped: false });
    await loadMapPoints({ data: { query: "tenant union" } });
    expect(mocks.mapPoints).toHaveBeenCalledWith(
      expect.objectContaining({ query: "tenant union" }),
    );

    mocks.mapPoints.mockClear();
    await loadMapPoints({ data: { query: "" } });
    expect(mocks.mapPoints).toHaveBeenCalledWith(expect.objectContaining({ query: undefined }));
  });

  it("seeds shared camera links near their saved viewport", async () => {
    mocks.mapPoints.mockResolvedValue({ points: [], total: 0, capped: false });

    await loadMapPoints({ data: { lng: -96.8, lat: 32.78, z: 9 } });

    const lastCall = mocks.mapPoints.mock.calls.at(-1);
    if (!lastCall) {
      throw new Error("Expected mapPoints to be called.");
    }
    const [request] = lastCall;
    expect(request.bounds.minLng).toBeGreaterThan(-100);
    expect(request.bounds.maxLng).toBeLessThan(-93);
  });
});
