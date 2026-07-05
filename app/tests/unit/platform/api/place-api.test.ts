import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as GeneratedAtlas from "@/lib/generated/atlas";

const placeMocks = vi.hoisted(() => ({
  getPlace: vi.fn(),
  getPlaceIssueSignals: vi.fn(),
  getPlacePageContext: vi.fn(),
  getPlaceProfile: vi.fn(),
  listPlaceEntities: vi.fn(),
  listPlaceSources: vi.fn(),
}));

vi.mock("@/lib/generated/atlas", async () => {
  const actual = await vi.importActual<typeof GeneratedAtlas>("@/lib/generated/atlas");
  return {
    ...actual,
    getPlace: placeMocks.getPlace,
    getPlaceIssueSignals: placeMocks.getPlaceIssueSignals,
    getPlacePageContext: placeMocks.getPlacePageContext,
    getPlaceProfile: placeMocks.getPlaceProfile,
    listPlaceEntities: placeMocks.listPlaceEntities,
    listPlaceSources: placeMocks.listPlaceSources,
  };
});

import { api } from "@/lib/api";

describe("api.places", () => {
  beforeEach(() => {
    placeMocks.getPlace.mockReset();
    placeMocks.getPlaceIssueSignals.mockReset();
    placeMocks.getPlacePageContext.mockReset();
    placeMocks.getPlaceProfile.mockReset();
    placeMocks.listPlaceEntities.mockReset();
    placeMocks.listPlaceSources.mockReset();
  });

  it("loads the place page bundle from the generated place endpoints", async () => {
    placeMocks.getPlace.mockResolvedValueOnce({
      place: { city: "Gary", state: "IN", region: null, display: "Gary, IN" },
      resource_uri: "atlas://places/gary-in",
    });
    placeMocks.getPlacePageContext.mockResolvedValueOnce({
      place_key: "gary-in",
      name: "Gary",
      display: "Gary, IN",
      kind: "city",
      scopes: [{ label: "City", href: "/places/gary-in", active: true }],
      summary_facts: [{ label: "County", value: "Lake County", attribution: null }],
      governments: [
        {
          name: "City of Gary",
          role: "Mayor and common council.",
          links: [{ label: "Council agendas", href: "https://gary.gov/" }],
        },
      ],
      places: [
        {
          name: "Downtown Gary",
          href: "/places/neighborhoods/downtown-gary-in",
          kind: "neighborhood",
          summary: "City hall, transit, small businesses, and civic offices.",
          accent: "neutral",
        },
      ],
      resource_uri: "atlas://places/gary-in/page-context",
    });
    placeMocks.listPlaceEntities.mockResolvedValueOnce({
      items: [
        {
          id: "entry-1",
          type: "organization",
          name: "Gary Housing Action",
          description: "Tenant organizing and housing repair advocacy.",
          address: { city: "Gary", state: "IN", region: null },
          contact: {},
          claim: null,
          issue_area_ids: ["housing_affordability"],
          source_types: ["government_record"],
          source_count: 2,
          slug: "gary-housing-action",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          active: true,
          verified: false,
          freshness: { latest_source_date: "2026-07-02" },
        },
      ],
      total: 1,
      next_cursor: "20",
    });
    placeMocks.getPlaceIssueSignals.mockResolvedValueOnce({
      issues: [
        {
          issue_area_id: "housing_affordability",
          name: "Housing affordability",
          domain: "housing",
          entity_count: 1,
          source_count: 2,
          top_entities: [],
        },
      ],
      place: { city: "Gary", state: "IN", region: null, display: "Gary, IN" },
      resource_uri: "atlas://places/gary-in/issue-signals",
    });
    placeMocks.getPlaceProfile.mockResolvedValueOnce({
      place: { city: "Gary", state: "IN", region: null, display: "Gary, IN" },
      demographics: { population: 67324 },
      economics: { median_household_income: 36785 },
      housing: { rent_burden_rate: 0.47 },
      education: {},
      health: { uninsured_rate: 0.12 },
      provenance: [{ dataset: "American Community Survey 5-year estimates", year: 2023 }],
      resource_uri: "atlas://places/gary-in/profile",
    });
    placeMocks.listPlaceSources.mockResolvedValueOnce({
      items: [
        {
          id: "source-1",
          url: "https://example.test/gary-agenda",
          title: "City council considers housing repair fund",
          publication: "Gary Common Council",
          type: "government_record",
          extraction_method: "manual",
          linked_entity_ids: ["entry-1"],
          linked_entities: [
            {
              id: "entry-1",
              name: "Gary Housing Action",
              type: "organization",
              slug: "gary-housing-action",
            },
          ],
          freshness: {
            published_date: "2026-07-02",
            ingested_at: "2026-07-03T00:00:00.000Z",
            created_at: "2026-07-03T00:00:00.000Z",
            staleness_status: "fresh",
            staleness_reason: "Recent public record.",
          },
          resource_uri: "atlas://sources/source-1",
        },
      ],
      total: 1,
      next_cursor: null,
    });

    const result = await api.places.getPage("gary-in");

    expect(placeMocks.getPlace).toHaveBeenCalledWith("gary-in");
    expect(placeMocks.getPlacePageContext).toHaveBeenCalledWith("gary-in");
    expect(placeMocks.listPlaceEntities).toHaveBeenCalledWith("gary-in", { limit: 20 });
    expect(placeMocks.getPlaceIssueSignals).toHaveBeenCalledWith("gary-in");
    expect(placeMocks.getPlaceProfile).toHaveBeenCalledWith("gary-in");
    expect(placeMocks.listPlaceSources).toHaveBeenCalledWith("gary-in", { limit: 10 });
    expect(result.identity.name).toBe("Gary");
    expect(result.identity.scopes).toEqual([
      { label: "City", href: "/places/gary-in", active: true },
    ]);
    expect(result.summaryFacts).toEqual([
      { label: "County", value: "Lake County", attribution: undefined },
    ]);
    expect(result.governments[0]?.name).toBe("City of Gary");
    expect(result.places[0]?.name).toBe("Downtown Gary");
    expect(result.actors.items[0]?.name).toBe("Gary Housing Action");
    expect(result.actors.nextCursor).toBe("20");
    expect(result.issues[0]?.name).toBe("Housing affordability");
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Population",
          value: "67,324",
          attribution: "American Community Survey 5-year estimates, 2023",
        }),
        expect.objectContaining({
          label: "Rent-burdened households",
          value: "47%",
        }),
      ]),
    );
    expect(result.latest.items[0]).toEqual(
      expect.objectContaining({
        title: "City council considers housing repair fund",
        attribution: "Gary Common Council, Jul 2",
        dateLabel: "Jul 2",
        linkedActors: [
          {
            id: "entry-1",
            name: "Gary Housing Action",
            href: "/profiles/organizations/gary-housing-action",
          },
        ],
        linkedEntityIds: ["entry-1"],
        sourceType: "government_record",
      }),
    );
    expect(result.latest.nextCursor).toBeUndefined();
  });

  it("loads paginated latest activity for a place", async () => {
    placeMocks.listPlaceSources.mockResolvedValueOnce({
      items: [
        {
          id: "source-2",
          url: "https://example.test/gary-report",
          title: "Gary housing conditions report",
          publication: "City Lab",
          type: "report",
          extraction_method: "manual",
          extraction_context: "The report names repair funds and tenant groups.",
          linked_entity_ids: ["entry-2"],
          linked_entities: [
            {
              id: "entry-2",
              name: "Gary Tenants Union",
              type: "organization",
              slug: "gary-tenants-union",
            },
          ],
          freshness: {
            published_date: "2026-06-20",
            ingested_at: "2026-06-21T00:00:00.000Z",
            created_at: "2026-06-21T00:00:00.000Z",
            staleness_status: "fresh",
            staleness_reason: "Recent report.",
          },
          resource_uri: "atlas://sources/source-2",
        },
      ],
      total: 2,
      next_cursor: "10",
    });

    const result = await api.places.listLatest("gary-in", {
      cursor: "5",
      limit: 10,
      query: "housing",
      sourceTypes: ["report"],
    });

    expect(placeMocks.listPlaceSources).toHaveBeenCalledWith("gary-in", {
      cursor: "5",
      limit: 10,
      source_type: ["report"],
      text: "housing",
    });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          title: "Gary housing conditions report",
          sourceType: "report",
          linkedActors: [
            {
              id: "entry-2",
              name: "Gary Tenants Union",
              href: "/profiles/organizations/gary-tenants-union",
            },
          ],
        }),
      ],
      nextCursor: "10",
    });
  });

  it("loads sorted people and organizations for a place", async () => {
    placeMocks.listPlaceEntities.mockResolvedValueOnce({
      items: [
        {
          id: "entry-3",
          type: "organization",
          name: "Zeta Recent Coalition",
          description: "Recent housing coalition.",
          address: { city: "Gary", state: "IN", region: null },
          contact: {},
          claim: null,
          issue_area_ids: ["housing_affordability"],
          source_types: ["report"],
          source_count: 1,
          slug: "zeta-recent-coalition",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          active: true,
          verified: false,
          freshness: { latest_source_date: "2026-07-04" },
        },
      ],
      total: 4,
      next_cursor: "20",
    });

    const result = await api.places.listActors("gary-in", {
      cursor: "10",
      limit: 20,
      query: "housing",
      sort: "recent",
      type: "organization",
    });

    expect(placeMocks.listPlaceEntities).toHaveBeenCalledWith("gary-in", {
      cursor: "10",
      entity_type: ["organization"],
      limit: 20,
      sort: "recent",
      text: "housing",
    });
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        href: "/profiles/organizations/zeta-recent-coalition",
        latest: "Jul 4",
        name: "Zeta Recent Coalition",
      }),
    );
    expect(result.nextCursor).toBe("20");
  });
});
