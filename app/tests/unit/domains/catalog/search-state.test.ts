import { describe, expect, it } from "vitest";
import {
  buildBrowseSearch,
  hasActiveBrowseSearch,
  parseList,
  serializeList,
  toggleValue,
} from "@/domains/catalog/search-state";

describe("parseList", () => {
  it("splits comma-separated values and trims whitespace", () => {
    expect(parseList(" labor, climate ,housing ")).toEqual(["labor", "climate", "housing"]);
  });

  it("returns an empty list when no value is provided", () => {
    expect(parseList(undefined)).toEqual([]);
  });
});

describe("serializeList", () => {
  it("returns undefined for an empty list", () => {
    expect(serializeList([])).toBeUndefined();
  });

  it("joins values into a comma-separated string", () => {
    expect(serializeList(["labor", "climate"])).toBe("labor,climate");
  });
});

describe("toggleValue", () => {
  it("adds a value that is not present", () => {
    expect(toggleValue(["labor"], "climate")).toEqual(["labor", "climate"]);
  });

  it("removes a value that is present", () => {
    expect(toggleValue(["labor", "climate"], "labor")).toEqual(["climate"]);
  });
});

describe("buildBrowseSearch", () => {
  it("parses every supported filter list from route search state", () => {
    expect(
      buildBrowseSearch({
        query: "mutual aid",
        view: "grid",
        states: "MI,OH",
        cities: "Detroit",
        regions: "Rust Belt",
        issue_areas: "housing,labor",
        entry_types: "organization,initiative",
        source_types: "news_article,podcast",
        offset: 20,
      }),
    ).toEqual({
      query: "mutual aid",
      view: "grid",
      states: ["MI", "OH"],
      cities: ["Detroit"],
      regions: ["Rust Belt"],
      issue_areas: ["housing", "labor"],
      entry_types: ["organization", "initiative"],
      source_types: ["news_article", "podcast"],
      offset: 20,
    });
  });

  it("defaults the browse surface to map view", () => {
    expect(
      buildBrowseSearch({
        query: "housing",
      }),
    ).toMatchObject({
      query: "housing",
      view: "map",
    });
  });
});

describe("hasActiveBrowseSearch", () => {
  it("returns false when no query or filters are applied", () => {
    expect(
      hasActiveBrowseSearch({
        query: undefined,
        view: "map",
        states: [],
        cities: [],
        regions: [],
        issue_areas: [],
        entry_types: [],
        source_types: [],
        offset: 0,
      }),
    ).toBe(false);
  });

  it("returns true when a filter or query is present", () => {
    expect(
      hasActiveBrowseSearch({
        query: undefined,
        view: "map",
        states: [],
        cities: [],
        regions: [],
        issue_areas: ["housing"],
        entry_types: [],
        source_types: [],
        offset: 0,
      }),
    ).toBe(true);
  });
});
