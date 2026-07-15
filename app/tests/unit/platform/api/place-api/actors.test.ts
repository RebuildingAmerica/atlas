import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as GeneratedAtlas from "@rebuildingamerica/atlas-api-client/generated/atlas";

const placeMocks = vi.hoisted(() => ({
  getPlace: vi.fn(),
  getPlaceIssueSignals: vi.fn(),
  getPlacePageContext: vi.fn(),
  getPlaceProfile: vi.fn(),
  listPlaceEntities: vi.fn(),
  listPlaceSources: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-api-client/generated/atlas", async () => {
  const actual = await vi.importActual<typeof GeneratedAtlas>(
    "@rebuildingamerica/atlas-api-client/generated/atlas",
  );
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

import { api } from "@rebuildingamerica/atlas-api-client";

describe("api.places actors", () => {
  beforeEach(() => {
    placeMocks.listPlaceEntities.mockReset();
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
      kind: "city",
      limit: 20,
      query: "housing",
      sort: "recent",
      type: "organization",
    });

    expect(placeMocks.listPlaceEntities).toHaveBeenCalledWith("gary-in", {
      cursor: "10",
      entity_type: ["organization"],
      kind: "city",
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
