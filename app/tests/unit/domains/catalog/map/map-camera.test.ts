import { describe, expect, it } from "vitest";
import { FLY_TO_DURATION_MS, flyToPlace } from "@rebuildingamerica/atlas-catalog/map/map-camera";
import { createFlyToHarness } from "../../../../helpers/catalog/map-camera-harness";

describe("flyToPlace", () => {
  it("sweeps to the destination along a gentle arc by default", () => {
    const { map, flyCalls, jumpCalls } = createFlyToHarness();
    flyToPlace(map, { lng: -97.7, lat: 30.3 }, 9);
    expect(flyCalls).toHaveLength(1);
    expect(flyCalls[0]?.center).toEqual([-97.7, 30.3]);
    expect(flyCalls[0]?.zoom).toBe(9);
    expect(flyCalls[0]?.duration).toBe(FLY_TO_DURATION_MS);
    expect(flyCalls[0]?.essential).toBe(true);
    expect(jumpCalls).toHaveLength(0);
  });

  it("jumps straight there for reduced-motion visitors", () => {
    const { map, flyCalls, jumpCalls } = createFlyToHarness();
    flyToPlace(map, { lng: -97.7, lat: 30.3 }, 9, { reducedMotion: true });
    expect(jumpCalls).toHaveLength(1);
    expect(jumpCalls[0]).toEqual({ center: [-97.7, 30.3], zoom: 9 });
    expect(flyCalls).toHaveLength(0);
  });

  it("does nothing when the map has not mounted", () => {
    expect(() => {
      flyToPlace(null, { lng: -97.7, lat: 30.3 }, 9);
    }).not.toThrow();
  });
});
