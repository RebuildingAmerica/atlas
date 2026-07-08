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

describe("api.places latest", () => {
  beforeEach(() => {
    placeMocks.listPlaceSources.mockReset();
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
      kind: "city",
      limit: 10,
      query: "housing",
      sourceTypes: ["report"],
    });

    expect(placeMocks.listPlaceSources).toHaveBeenCalledWith("gary-in", {
      cursor: "5",
      kind: "city",
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

  it("derives latest topics from linked actor issue areas", async () => {
    placeMocks.listPlaceSources.mockResolvedValueOnce({
      items: [
        {
          id: "source-issue-topics",
          url: "https://example.test/gary-council-issues",
          title: "Council hears transit and housing testimony",
          publication: "Gary Common Council",
          type: "government_record",
          extraction_method: "manual",
          linked_entity_ids: ["entry-4", "entry-5"],
          linked_entities: [
            {
              id: "entry-4",
              name: "Gary Transit Riders",
              type: "organization",
              slug: "gary-transit-riders",
              issue_area_ids: ["public_transit", "housing_affordability"],
            },
            {
              id: "entry-5",
              name: "Gary Housing Action",
              type: "organization",
              slug: "gary-housing-action",
              issue_area_ids: ["housing_affordability"],
            },
          ],
          freshness: {
            published_date: "2026-07-05",
            ingested_at: "2026-07-05T12:00:00.000Z",
            created_at: "2026-07-05T12:00:00.000Z",
            staleness_status: "fresh",
            staleness_reason: "Recent public record.",
          },
          resource_uri: "atlas://sources/source-issue-topics",
        },
      ],
      total: 1,
      next_cursor: null,
    });

    const result = await api.places.listLatest("gary-in");

    expect(result.items[0]?.topics).toEqual(["Public transit", "Housing affordability"]);
  });
});
