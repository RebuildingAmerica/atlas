import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/orval/fetcher", () => ({
  atlasFetch: vi.fn(),
}));

import { api, buildEntityListParams } from "@/lib/api";
import { atlasFetch } from "@/lib/orval/fetcher";

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

describe("api.entries.getBySlug and getConnections", () => {
  const fetchMock = atlasFetch as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetches a person entry by slug and maps the detail response", async () => {
    const detailResponse = {
      id: "ent_1",
      type: "person",
      name: "Ada Lovelace",
      description: "Mathematician",
      address: {},
      contact: {},
      claim: null,
      issue_area_ids: [],
      source_types: [],
      source_count: 0,
      slug: "ada-lovelace-1234",
      created_at: "2026-04-10T00:00:00.000Z",
      updated_at: "2026-04-10T00:00:00.000Z",
      active: true,
      verified: false,
      freshness: {},
      sources: [],
    };
    fetchMock.mockResolvedValueOnce(detailResponse);

    const result = await api.entries.getBySlug("people", "ada-lovelace-1234");

    expect(fetchMock).toHaveBeenCalledWith("/api/entities/by-slug/people/ada-lovelace-1234");
    expect(result.id).toBe("ent_1");
    expect(result.slug).toBe("ada-lovelace-1234");
  });

  it("fetches related actor connections and returns the grouped list", async () => {
    fetchMock.mockResolvedValueOnce({
      connections: [
        {
          relationship: "co-organizer",
          entries: [],
        },
      ],
    });

    const result = await api.entries.getConnections("ent_1");

    expect(fetchMock).toHaveBeenCalledWith("/api/entities/ent_1/connections");
    expect(result).toEqual([{ relationship: "co-organizer", entries: [] }]);
  });
});
