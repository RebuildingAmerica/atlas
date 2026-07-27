import { describe, expect, it } from "vitest";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import { homeFacets } from "./home-page-data-test-support";
import {
  browseUrl,
  buildHomeIssueTiles,
  buildHomePlaceTiles,
  buildHomeSourceTiles,
  buildHomeTypeTiles,
  formatLocation,
  formatStatCount,
  humanizeIssue,
  profileHref,
} from "@/platform/pages/home-page-data";

describe("browseUrl", () => {
  it("escapes the visitor's words into a browse query", () => {
    expect(browseUrl("tenant unions & rent")).toBe(
      "/browse?query=tenant%20unions%20%26%20rent&offset=0",
    );
  });
});

describe("formatStatCount", () => {
  it("groups a real count and stays silent about counts it does not have", () => {
    expect(formatStatCount(12345)).toBe("12,345");
    expect(formatStatCount(1)).toBe("1");
    expect(formatStatCount(0)).toBe("");
    expect(formatStatCount(-4)).toBe("");
    expect(formatStatCount(undefined)).toBe("");
  });
});

describe("humanizeIssue", () => {
  it("turns a taxonomy slug into a readable label", () => {
    expect(humanizeIssue("housing_affordability")).toBe("Housing Affordability");
    expect(humanizeIssue("criminal-justice__reform")).toBe("Criminal Justice Reform");
  });

  it("says the issue is unlisted rather than showing an empty label", () => {
    expect(humanizeIssue(undefined)).toBe("Unlisted");
    expect(humanizeIssue("")).toBe("Unlisted");
  });
});

describe("buildHomeIssueTiles", () => {
  it("ranks issues by record count, breaking ties alphabetically", () => {
    const tiles = buildHomeIssueTiles(
      homeFacets({
        issue_areas: [
          { count: 3, value: "voting_rights" },
          { count: 9, value: "housing_affordability" },
          { count: 3, value: "climate_resilience" },
        ],
      }),
    );

    expect(tiles).toEqual([
      {
        count: "9 records",
        href: "/browse?issue_areas=housing_affordability&offset=0",
        label: "Housing Affordability",
      },
      {
        count: "3 records",
        href: "/browse?issue_areas=climate_resilience&offset=0",
        label: "Climate Resilience",
      },
      {
        count: "3 records",
        href: "/browse?issue_areas=voting_rights&offset=0",
        label: "Voting Rights",
      },
    ]);
  });

  it("keeps the top eight issues and singularises a lone record", () => {
    const tiles = buildHomeIssueTiles(
      homeFacets({
        issue_areas: Array.from({ length: 10 }, (_unused, index) => ({
          count: 10 - index,
          value: `issue_${index}`,
        })),
      }),
    );

    expect(tiles).toHaveLength(8);
    expect(tiles[0]?.count).toBe("10 records");
    expect(
      buildHomeIssueTiles(homeFacets({ issue_areas: [{ count: 1, value: "housing" }] }))[0]?.count,
    ).toBe("1 record");
  });

  it("returns nothing when the search reported no facets at all", () => {
    expect(buildHomeIssueTiles(undefined)).toEqual([]);
    expect(buildHomeIssueTiles(homeFacets())).toEqual([]);
  });
});

describe("buildHomePlaceTiles", () => {
  it("names states in full and lists cities and regions after them", () => {
    const tiles = buildHomePlaceTiles(
      homeFacets({
        states: [
          { count: 12, value: "NV" },
          { count: 4, value: "ZZ" },
        ],
        cities: [{ count: 7, value: "Kansas City" }],
        regions: [{ count: 2, value: "Gulf Coast" }],
      }),
    );

    expect(tiles).toEqual([
      { count: "12 records", href: "/browse?states=NV&offset=0", label: "Nevada" },
      { count: "4 records", href: "/browse?states=ZZ&offset=0", label: "ZZ" },
      {
        count: "7 records",
        href: "/browse?cities=Kansas%20City&offset=0",
        label: "Kansas City",
      },
      {
        count: "2 records",
        href: "/browse?regions=Gulf%20Coast&offset=0",
        label: "Gulf Coast",
      },
    ]);
  });

  it("shows at most eight places", () => {
    const tiles = buildHomePlaceTiles(
      homeFacets({
        cities: Array.from({ length: 12 }, (_unused, index) => ({
          count: 12 - index,
          value: `City ${index}`,
        })),
      }),
    );

    expect(tiles).toHaveLength(8);
  });
});

describe("buildHomeSourceTiles", () => {
  it("labels known source types and humanises the rest", () => {
    const tiles = buildHomeSourceTiles(
      homeFacets({
        source_types: [
          { count: 5, value: "government_record" },
          { count: 2, value: "field_notes" },
        ],
      }),
    );

    expect(tiles).toEqual([
      {
        count: "5 records",
        href: "/browse?source_types=government_record&offset=0",
        label: "Government records",
      },
      {
        count: "2 records",
        href: "/browse?source_types=field_notes&offset=0",
        label: "Field Notes",
      },
    ]);
  });

  it("shows at most six source types", () => {
    const tiles = buildHomeSourceTiles(
      homeFacets({
        source_types: Array.from({ length: 9 }, (_unused, index) => ({
          count: 9 - index,
          value: `source_${index}`,
        })),
      }),
    );

    expect(tiles).toHaveLength(6);
  });
});

describe("buildHomeTypeTiles", () => {
  it("labels known entry types and humanises the rest", () => {
    const tiles = buildHomeTypeTiles(
      homeFacets({
        entity_types: [
          { count: 8, value: "organization" },
          { count: 1, value: "mutual_aid_pod" },
        ],
      }),
    );

    expect(tiles).toEqual([
      {
        count: "8 records",
        href: "/browse?entry_types=organization&offset=0",
        label: "Organizations",
      },
      {
        count: "1 record",
        href: "/browse?entry_types=mutual_aid_pod&offset=0",
        label: "Mutual Aid Pod",
      },
    ]);
  });

  it("shows at most five entry types", () => {
    const tiles = buildHomeTypeTiles(
      homeFacets({
        entity_types: Array.from({ length: 7 }, (_unused, index) => ({
          count: 7 - index,
          value: `type_${index}`,
        })),
      }),
    );

    expect(tiles).toHaveLength(5);
  });
});

describe("formatLocation", () => {
  it("prefers city and state, then region, and admits when neither is known", () => {
    expect(formatLocation(createEntryFixture({ city: "Jackson", state: "MS" }))).toBe(
      "Jackson, MS",
    );
    expect(formatLocation(createEntryFixture({ city: "Jackson", state: undefined }))).toBe(
      "Jackson",
    );
    expect(
      formatLocation(
        createEntryFixture({ city: undefined, state: undefined, region: "Gulf Coast" }),
      ),
    ).toBe("Gulf Coast");
    expect(
      formatLocation(createEntryFixture({ city: undefined, state: undefined, region: undefined })),
    ).toBe("Place not listed");
  });
});

describe("profileHref", () => {
  it("routes each entry type to its own profile section", () => {
    expect(profileHref(createEntryFixture({ type: "person", slug: "jane-doe" }))).toBe(
      "/profiles/people/jane-doe",
    );
    expect(profileHref(createEntryFixture({ type: "organization", slug: "kc-tenants" }))).toBe(
      "/profiles/organizations/kc-tenants",
    );
    expect(profileHref(createEntryFixture({ type: "initiative", slug: "rent-cap" }))).toBe(
      "/profiles/initiatives/rent-cap",
    );
    expect(profileHref(createEntryFixture({ type: "campaign", slug: "yes-on-3" }))).toBe(
      "/profiles/campaigns/yes-on-3",
    );
    expect(profileHref(createEntryFixture({ type: "event", slug: "town-hall" }))).toBe(
      "/profiles/events/town-hall",
    );
  });

  it("sends an unslugged entry to browse rather than a broken profile URL", () => {
    expect(profileHref(createEntryFixture({ slug: "" }))).toBe("/browse");
  });
});
