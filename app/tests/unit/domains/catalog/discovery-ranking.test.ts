import { describe, expect, it } from "vitest";
import { rankEntriesForDiscovery } from "@/domains/catalog/discovery-ranking";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";

describe("rankEntriesForDiscovery", () => {
  it("prefers exact name matches before broader text matches", () => {
    const exact = createEntryFixture({ id: "exact", name: "Phoenix Tenants Union" });
    const broad = createEntryFixture({
      id: "broad",
      name: "Arizona Housing Coalition",
      description: "Mentions Phoenix Tenants Union.",
      source_count: 8,
    });

    expect(
      rankEntriesForDiscovery([broad, exact], {
        issue_areas: [],
        query: "Phoenix Tenants Union",
        states: [],
      }).map((entry) => entry.id),
    ).toEqual(["exact", "broad"]);
  });

  it("prefers local place-plus-issue records with stronger and fresher evidence", () => {
    const localStrong = createEntryFixture({
      id: "local-strong",
      city: "Phoenix",
      state: "AZ",
      issue_areas: ["housing_affordability"],
      source_count: 5,
      latest_source_date: "2026-06-01",
      trust: {
        level: "corroborated",
        independent_source_count: 3,
        website_grounded: null,
        email_grounded: null,
      },
    });
    const nationalOlder = createEntryFixture({
      id: "national-old",
      city: undefined,
      state: "DC",
      geo_specificity: "national",
      issue_areas: ["housing_affordability"],
      source_count: 10,
      latest_source_date: "2024-01-01",
      trust: {
        level: "atlas_verified",
        independent_source_count: null,
        website_grounded: null,
        email_grounded: null,
      },
    });

    expect(
      rankEntriesForDiscovery([nationalOlder, localStrong], {
        cities: ["Phoenix"],
        issue_areas: ["housing_affordability"],
        query: "housing",
        states: ["AZ"],
      }).map((entry) => entry.id),
    ).toEqual(["local-strong", "national-old"]);
  });
});
