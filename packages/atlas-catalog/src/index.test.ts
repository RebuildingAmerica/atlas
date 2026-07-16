import { describe, expect, it } from "vitest";
import { humanize } from "./catalog";
import { viewFromSearch } from "./map/map-viewport";

describe("atlas catalog public behavior", () => {
  it("keeps catalog labels and shared map links deterministic", () => {
    expect(humanize("housing_affordability")).toBe("Housing Affordability");
    expect(viewFromSearch({ lat: 32.78, lng: -96.8, z: 9 })).toEqual({
      center: { lng: -96.8, lat: 32.78 },
      zoom: 9,
    });
  });
});
