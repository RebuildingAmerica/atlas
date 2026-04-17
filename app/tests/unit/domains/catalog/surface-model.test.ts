import { describe, expect, it } from "vitest";
import { buildStateDensity } from "@/domains/catalog/surface-model";

describe("buildStateDensity", () => {
  it("normalizes state facet counts for the atlas map surface", () => {
    expect(
      buildStateDensity([
        { value: "CA", count: 12 },
        { value: "MO", count: 6 },
        { value: "KS", count: 3 },
      ]),
    ).toEqual([
      { state: "CA", count: 12, intensity: 1 },
      { state: "MO", count: 6, intensity: 0.5 },
      { state: "KS", count: 3, intensity: 0.25 },
    ]);
  });

  it("returns an empty list when there are no state facets", () => {
    expect(buildStateDensity([])).toEqual([]);
  });

  it("keeps intensity at zero when every facet count is zero", () => {
    expect(
      buildStateDensity([
        { value: "CA", count: 0 },
        { value: "MO", count: 0 },
      ]),
    ).toEqual([
      { state: "CA", count: 0, intensity: 0 },
      { state: "MO", count: 0, intensity: 0 },
    ]);
  });
});
