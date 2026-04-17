import { describe, expect, it } from "vitest";
import { buildEntityListParams } from "@/lib/api";

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
      limit: undefined,
      cursor: undefined,
    });
  });
});
