import { describe, expect, it } from "vitest";
import {
  buildBrowseSearch,
  hasActiveBrowseSearch,
  parseList,
  resolveBrowseSearchIntent,
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
        source_patterns: "multi_source,social_only",
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
      source_patterns: ["multi_source", "social_only"],
      offset: 20,
    });
  });

  it("defaults the browse surface to list view", () => {
    expect(
      buildBrowseSearch({
        query: "housing",
      }),
    ).toMatchObject({
      query: "housing",
      view: "list",
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
        source_patterns: [],
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
        source_patterns: [],
        offset: 0,
      }),
    ).toBe(true);
  });
});

describe("resolveBrowseSearchIntent", () => {
  const issueAreaLabels = {
    housing_affordability: "Housing Affordability",
    worker_cooperatives: "Worker Cooperatives",
  };
  const cityNames = ["Phoenix", "Kansas City"];
  const regionNames = ["Las Vegas Valley", "Metro Detroit"];
  const entryTypeLabels = {
    person: "People",
    organization: "Organizations",
    initiative: "Initiatives",
    campaign: "Campaigns",
    event: "Events",
  };
  const sourceTypeLabels = {
    news_article: "Local news",
    podcast: "Podcasts",
    government_record: "Government records",
    org_website: "Organization sites",
  };
  const stateNameByCode = {
    IN: "Indiana",
    MO: "Missouri",
    KS: "Kansas",
  };
  const intentOptions = {
    cityNames,
    entryTypeLabels,
    issueAreaLabels,
    regionNames,
    sourceTypeLabels,
    stateNameByCode,
  };

  it("turns a place-plus-issue phrase into filters instead of a brittle text query", () => {
    expect(resolveBrowseSearchIntent("housing in Missouri", intentOptions)).toEqual({
      cities: [],
      entry_types: [],
      issue_areas: ["housing_affordability"],
      query: undefined,
      regions: [],
      source_types: [],
      states: ["MO"],
    });
  });

  it("maps tenant-union language to housing while extracting the place filter", () => {
    expect(resolveBrowseSearchIntent("tenant union in Missouri", intentOptions)).toEqual({
      cities: [],
      entry_types: [],
      issue_areas: ["housing_affordability"],
      query: undefined,
      regions: [],
      source_types: [],
      states: ["MO"],
    });
  });

  it("does not treat the word in as the Indiana state code", () => {
    expect(resolveBrowseSearchIntent("organizations in Missouri", intentOptions)).toEqual({
      cities: [],
      entry_types: ["organization"],
      issue_areas: [],
      query: undefined,
      regions: [],
      source_types: [],
      states: ["MO"],
    });
  });

  it("extracts city, region, actor type, and source type intent into visible filters", () => {
    expect(
      resolveBrowseSearchIntent(
        "organizations in Phoenix around Las Vegas Valley from local news",
        intentOptions,
      ),
    ).toEqual({
      cities: ["Phoenix"],
      entry_types: ["organization"],
      issue_areas: [],
      query: undefined,
      regions: ["Las Vegas Valley"],
      source_types: ["news_article"],
      states: [],
    });
  });

  it("maps common civic language to known issue filters without keeping duplicate query text", () => {
    expect(resolveBrowseSearchIntent("tenant organizers in Kansas City", intentOptions)).toEqual({
      cities: ["Kansas City"],
      entry_types: ["person"],
      issue_areas: ["housing_affordability"],
      query: undefined,
      regions: [],
      source_types: [],
      states: [],
    });
  });
});
