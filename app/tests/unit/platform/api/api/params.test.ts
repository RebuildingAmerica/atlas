import { describe, expect, it } from "vitest";

import { buildEntityListParams, buildMapPointParams } from "@rebuildingamerica/atlas-api-client";
import { CONUS_BOUNDS } from "../../../../fixtures/catalog/map";

describe("buildEntityListParams", () => {
  it("maps the legacy browse filter shape onto the generated entity list params", () => {
    expect(
      buildEntityListParams({
        query: "housing",
        states: ["MO", "KS"],
        cities: ["Kansas City"],
        regions: ["Midwest"],
        issue_areas: ["housing_affordability", "worker_cooperatives"],
        entry_types: ["organization", "person"],
        source_types: ["news_article", "report"],
        source_patterns: ["multi_source"],
        affiliated_org_id: "org_123",
        limit: 20,
        offset: 40,
      }),
    ).toEqual({
      query: "housing",
      state: ["MO", "KS"],
      city: ["Kansas City"],
      region: ["Midwest"],
      issue_area: ["housing_affordability", "worker_cooperatives"],
      entity_type: ["organization", "person"],
      source_type: ["news_article", "report"],
      source_pattern: ["multi_source"],
      affiliated_org_id: "org_123",
      limit: 20,
      cursor: "40",
    });
  });

  it("omits the cursor when the browse state has not paged yet", () => {
    expect(buildEntityListParams({ query: "housing" })).toEqual({
      query: "housing",
      state: undefined,
      city: undefined,
      region: undefined,
      issue_area: undefined,
      entity_type: undefined,
      source_type: undefined,
      source_pattern: undefined,
      affiliated_org_id: undefined,
      limit: undefined,
      cursor: undefined,
    });
  });
});

describe("buildMapPointParams", () => {
  it("maps the viewport query onto the generated map-endpoint params", () => {
    expect(
      buildMapPointParams({
        bounds: CONUS_BOUNDS,
        query: "housing",
        states: ["MO", "KS"],
        cities: ["Kansas City"],
        regions: ["Midwest"],
        issue_areas: ["housing_affordability"],
        entry_types: ["organization"],
        source_types: ["news_article"],
        source_patterns: ["multi_source"],
        limit: 1500,
      }),
    ).toEqual({
      min_lng: -125,
      min_lat: 24,
      max_lng: -66.5,
      max_lat: 49.5,
      query: "housing",
      state: ["MO", "KS"],
      city: ["Kansas City"],
      region: ["Midwest"],
      issue_area: ["housing_affordability"],
      entity_type: ["organization"],
      source_type: ["news_article"],
      source_pattern: ["multi_source"],
      limit: 1500,
    });
  });

  it("leaves the facet filters undefined when only a bounding box is given", () => {
    expect(buildMapPointParams({ bounds: CONUS_BOUNDS })).toEqual({
      min_lng: -125,
      min_lat: 24,
      max_lng: -66.5,
      max_lat: 49.5,
      query: undefined,
      state: undefined,
      city: undefined,
      region: undefined,
      issue_area: undefined,
      entity_type: undefined,
      source_type: undefined,
      source_pattern: undefined,
      limit: undefined,
    });
  });
});
