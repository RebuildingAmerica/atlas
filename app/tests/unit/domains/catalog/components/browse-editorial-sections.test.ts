import { describe, expect, it } from "vitest";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import { buildBrowseEditorialSections } from "@/domains/catalog/components/browse/browse-editorial-sections";
import type { EntryListResponse } from "@rebuildingamerica/atlas-api-client";

describe("buildBrowseEditorialSections", () => {
  const responseFixture = (overrides: Partial<EntryListResponse> = {}): EntryListResponse => ({
    data: [],
    facets: {
      cities: [],
      entity_types: [],
      issue_areas: [],
      regions: [],
      source_patterns: [],
      source_types: [],
      states: [],
    },
    pagination: {
      has_more: false,
      limit: 20,
      offset: 0,
      total: 0,
    },
    ...overrides,
  });

  it("derives primitive sections from real entries and facets", () => {
    const sections = buildBrowseEditorialSections({
      issueAreaLabels: {
        housing_affordability: "Housing Affordability",
        worker_power: "Worker Power",
      },
      response: responseFixture({
        data: [
          createEntryFixture({
            id: "person",
            name: "Ana Civic",
            city: "Kansas City",
            issue_areas: ["worker_power"],
            latest_source_date: "2026-01-01",
            source_count: 1,
            type: "person",
            updated_at: "2026-01-02T00:00:00Z",
          }),
          createEntryFixture({
            id: "organization",
            name: "Tenant Union",
            city: "Kansas City",
            issue_areas: ["housing_affordability"],
            latest_source_date: "2026-02-01",
            source_count: 8,
            state: "MO",
            type: "organization",
            updated_at: "2026-02-02T00:00:00Z",
          }),
          createEntryFixture({
            id: "initiative",
            name: "Neighborhood Housing Fund",
            city: "Independence",
            issue_areas: ["housing_affordability"],
            latest_source_date: "2026-04-10",
            source_count: 3,
            state: "MO",
            type: "initiative",
            updated_at: "2026-04-11T00:00:00Z",
          }),
        ],
        facets: {
          cities: [{ count: 5, value: "Kansas City" }],
          entity_types: [{ count: 7, value: "organization" }],
          issue_areas: [
            { count: 11, value: "housing_affordability" },
            { count: 4, value: "worker_power" },
          ],
          regions: [{ count: 3, value: "Midwest" }],
          source_patterns: [{ count: 99, value: "press_release" }],
          source_types: [{ count: 9, value: "government_record" }],
          states: [{ count: 12, value: "MO" }],
        },
      }),
    });

    expect(sections.activeIssues.map((issue) => issue.label)).toEqual([
      "Housing Affordability",
      "Worker Power",
    ]);
    expect(sections.activeIssues[0]).toMatchObject({
      actorCount: 2,
      detail: "Kansas City, Missouri",
      evidenceCount: 11,
      featuredActor: "Tenant Union",
      latestSourceDate: "2026-04-10",
      placeCount: 2,
      summary: "Tenant Union and 1 more are active in Kansas City, Missouri.",
    });
    expect(sections.activePlaces.map((place) => place.label)).toEqual([
      "Missouri",
      "Kansas City",
      "Midwest",
    ]);
    expect("sourceTypes" in sections).toBe(false);
    expect(sections.entriesByType.person.map((entry) => entry.name)).toEqual(["Ana Civic"]);
    expect(sections.entriesByType.organization.map((entry) => entry.name)).toEqual([
      "Tenant Union",
    ]);
    expect(sections.entriesByType.initiative.map((entry) => entry.name)).toEqual([
      "Neighborhood Housing Fund",
    ]);
    expect(sections.entriesByType.campaign).toEqual([]);
    expect(sections.entriesByType.event).toEqual([]);
  });

  it("does not invent fallback shelves when the catalog is empty", () => {
    const sections = buildBrowseEditorialSections({
      issueAreaLabels: {},
      response: responseFixture(),
    });

    expect(sections.activeIssues).toEqual([]);
    expect(sections.activePlaces).toEqual([]);
    expect(sections.entriesByType).toEqual({
      campaign: [],
      event: [],
      initiative: [],
      organization: [],
      person: [],
    });
    expect("sourceTypes" in sections).toBe(false);
  });
  it("breaks ties between equally common issues and equally sourced entries by name", () => {
    const sections = buildBrowseEditorialSections({
      issueAreaLabels: { housing_affordability: "Housing Affordability" },
      response: responseFixture({
        data: [
          createEntryFixture({
            city: "Jackson",
            id: "b",
            issue_areas: ["housing_affordability"],
            name: "Beta Coalition",
            source_count: 4,
            state: "MS",
            type: "organization",
          }),
          createEntryFixture({
            city: "Jackson",
            id: "a",
            issue_areas: ["housing_affordability"],
            name: "Alpha Coalition",
            source_count: 4,
            state: "MS",
            type: "organization",
          }),
        ],
        facets: {
          cities: [],
          entity_types: [],
          issue_areas: [
            { count: 4, value: "worker_power" },
            { count: 4, value: "housing_affordability" },
          ],
          regions: [],
          source_patterns: [],
          source_types: [],
          states: [],
        },
      }),
    });

    expect(sections.activeIssues.map((issue) => issue.value)).toEqual([
      "housing_affordability",
      "worker_power",
    ]);
    expect(sections.entriesByType.organization.map((entry) => entry.name)).toEqual([
      "Alpha Coalition",
      "Beta Coalition",
    ]);
    expect(sections.activeIssues[0]?.featuredActor).toBe("Alpha Coalition");
  });

  it("titles an unlabelled issue slug in sentence case, keeping small words lowercase", () => {
    const sections = buildBrowseEditorialSections({
      issueAreaLabels: {},
      response: responseFixture({
        facets: {
          cities: [],
          entity_types: [],
          issue_areas: [{ count: 2, value: "housing_and_the_courts" }],
          regions: [],
          source_patterns: [],
          source_types: [],
          states: [],
        },
      }),
    });

    expect(sections.activeIssues[0]?.label).toBe("Housing and the Courts");
  });

  it("places a featured actor by city, state, or region — whichever the record has", () => {
    const place = (overrides: Partial<Parameters<typeof createEntryFixture>[0]>) =>
      buildBrowseEditorialSections({
        issueAreaLabels: {},
        response: responseFixture({
          data: [createEntryFixture({ issue_areas: ["housing"], ...overrides })],
          facets: {
            cities: [],
            entity_types: [],
            issue_areas: [{ count: 1, value: "housing" }],
            regions: [],
            source_patterns: [],
            source_types: [],
            states: [],
          },
        }),
      }).activeIssues[0];

    expect(place({ city: "Jackson", state: "MS" })?.detail).toBe("Jackson, Mississippi");
    // An unrecognised code stands in for itself rather than disappearing.
    expect(place({ city: "Jackson", state: "ZZ" })?.detail).toBe("Jackson, ZZ");
    expect(place({ city: "Jackson", state: undefined })?.detail).toBe("Jackson");
    expect(place({ city: undefined, state: "MS" })?.detail).toBe("Mississippi");
    expect(place({ city: undefined, region: "Gulf Coast", state: undefined })?.detail).toBe(
      "Gulf Coast",
    );
  });

  it("summarizes a lone placeless actor without claiming a location", () => {
    const sections = buildBrowseEditorialSections({
      issueAreaLabels: {},
      response: responseFixture({
        data: [
          createEntryFixture({
            city: undefined,
            issue_areas: ["housing"],
            name: "Prairie Coop",
            region: undefined,
            state: undefined,
          }),
        ],
        facets: {
          cities: [],
          entity_types: [],
          issue_areas: [{ count: 1, value: "housing" }],
          regions: [],
          source_patterns: [],
          source_types: [],
          states: [],
        },
      }),
    });

    expect(sections.activeIssues[0]?.summary).toBe("Prairie Coop is active.");
    expect(sections.activeIssues[0]?.detail).toBeUndefined();
  });
});
