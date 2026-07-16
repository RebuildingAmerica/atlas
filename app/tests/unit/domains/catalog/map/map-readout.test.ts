import { describe, expect, it } from "vitest";
import { readViewport } from "@rebuildingamerica/atlas-catalog/map/map-readout";
import { makeFakeMap } from "../../../../helpers/catalog/fake-map";

describe("readViewport", () => {
  it("reads the camera and bounding box off a map instance", () => {
    const map = makeFakeMap({
      center: { lng: -96.8, lat: 32.78 },
      zoom: 7,
      bounds: {
        sw: { lng: -125, lat: 24 },
        ne: { lng: -66.5, lat: 49.5 },
      },
    });

    expect(readViewport(map)).toEqual({
      view: { center: { lng: -96.8, lat: 32.78 }, zoom: 7 },
      bounds: { minLng: -125, minLat: 24, maxLng: -66.5, maxLat: 49.5 },
    });
  });
});
