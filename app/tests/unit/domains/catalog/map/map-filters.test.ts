import { describe, expect, it } from "vitest";
import { mapPointParamsFor } from "@/domains/catalog/map/map-filters";
import { CONUS_BOUNDS, makeBrowseSearchState } from "../../../../fixtures/catalog/map";

describe("mapPointParamsFor", () => {
  it("threads the browse facets and the bounding box into one viewport query", () => {
    const params = mapPointParamsFor(
      makeBrowseSearchState({
        query: "housing",
        states: ["TX"],
        cities: ["Dallas, TX"],
        regions: ["south"],
        issue_areas: ["housing-affordability"],
        entry_types: ["organization"],
        source_types: ["news_article"],
        source_patterns: ["multi_source"],
      }),
      CONUS_BOUNDS,
    );

    expect(params).toEqual({
      bounds: CONUS_BOUNDS,
      query: "housing",
      states: ["TX"],
      cities: ["Dallas, TX"],
      regions: ["south"],
      issue_areas: ["housing-affordability"],
      entry_types: ["organization"],
      source_types: ["news_article"],
      source_patterns: ["multi_source"],
    });
  });

  it("drops an empty query string so a blank search isn't sent as a filter", () => {
    expect(
      mapPointParamsFor(makeBrowseSearchState({ query: "" }), CONUS_BOUNDS).query,
    ).toBeUndefined();
  });
});
