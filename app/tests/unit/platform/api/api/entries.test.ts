import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as GeneratedAtlas from "@/lib/generated/atlas";

vi.mock("@/lib/orval/fetcher", () => ({
  atlasFetch: vi.fn(),
}));

const mapMocks = vi.hoisted(() => ({
  getEntitiesMap: vi.fn(),
}));

vi.mock("@/lib/generated/atlas", async () => {
  const actual = await vi.importActual<typeof GeneratedAtlas>("@/lib/generated/atlas");
  return {
    ...actual,
    getEntitiesMap: mapMocks.getEntitiesMap,
  };
});

import { api } from "@/lib/api";
import { atlasFetch } from "@/lib/orval/fetcher";

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
      actor_quality: {
        level: "specific_actor",
        score: 5,
        total: 5,
        present: ["actor", "work", "place", "issues", "sources"],
        missing: [],
      },
      issue_area_ids: [],
      source_types: [],
      source_count: 0,
      slug: "ada-lovelace-1234",
      profile_url: "https://atlas.rebuildingus.org/profiles/people/ada-lovelace-1234",
      created_at: "2026-04-10T00:00:00.000Z",
      updated_at: "2026-04-10T00:00:00.000Z",
      active: true,
      verified: false,
      freshness: {},
      sources: [
        {
          id: "src_1",
          url: "https://example.org/source",
          title: "Profile source",
          publication: "Example",
          type: "news_article",
          extraction_method: "manual",
          extraction_context: "Ada Lovelace is profiled as a civic actor.",
          linked_entity_ids: ["ent_1"],
          freshness: {
            created_at: "2024-01-01T00:00:00.000Z",
            published_date: "2024-01-01",
            ingested_at: "2024-01-02T00:00:00.000Z",
            staleness_status: "stale",
            staleness_reason: "Most recent source record date is more than a year old.",
          },
          resource_uri: "atlas://sources/src_1",
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(detailResponse);

    const result = await api.entries.getBySlug("people", "ada-lovelace-1234");

    expect(fetchMock).toHaveBeenCalledWith("/api/entities/by-slug/people/ada-lovelace-1234");
    expect(result.id).toBe("ent_1");
    expect(result.slug).toBe("ada-lovelace-1234");
    expect(result.profile_url).toBe(
      "https://atlas.rebuildingus.org/profiles/people/ada-lovelace-1234",
    );
    expect(result.actor_quality).toEqual({
      level: "specific_actor",
      score: 5,
      total: 5,
      present: ["actor", "work", "place", "issues", "sources"],
      missing: [],
    });
    expect(result.trust).toEqual({
      level: "unverified",
      independent_source_count: null,
      website_grounded: null,
      email_grounded: null,
    });
    expect(result.sources?.[0]?.freshness).toEqual({
      created_at: "2024-01-01T00:00:00.000Z",
      published_date: "2024-01-01",
      ingested_at: "2024-01-02T00:00:00.000Z",
      staleness_status: "stale",
      staleness_reason: "Most recent source record date is more than a year old.",
    });
  });

  it("maps an honest trust block when the API provides one", async () => {
    fetchMock.mockResolvedValueOnce({
      id: "ent_2",
      type: "organization",
      name: "Prairie Workers Cooperative",
      description: "Worker-owned co-op",
      address: {},
      contact: {},
      claim: null,
      trust: {
        level: "corroborated",
        independent_source_count: 3,
        website_grounded: true,
        email_grounded: false,
      },
      issue_area_ids: [],
      source_types: [],
      source_count: 3,
      slug: "prairie-workers-cooperative-1",
      profile_url: null,
      created_at: "2026-04-10T00:00:00.000Z",
      updated_at: "2026-04-10T00:00:00.000Z",
      active: true,
      verified: false,
      freshness: {},
      sources: [],
    });

    const result = await api.entries.getBySlug("organizations", "prairie-workers-cooperative-1");

    expect(result.trust).toEqual({
      level: "corroborated",
      independent_source_count: 3,
      website_grounded: true,
      email_grounded: false,
    });
    expect(result.profile_url).toBeUndefined();
  });

  it("maps the ranked connection network from the API", async () => {
    fetchMock.mockResolvedValueOnce({
      actors: [
        {
          id: "a1",
          name: "Marcus Lee",
          type: "person",
          slug: "marcus-lee",
          description_snippet: "Advocate",
          score: 4,
          strength: 80,
          tier: "moderate",
          reasons: [{ kind: "sourced_edge", label: "Staff profile", count: 1, source_id: "src_1" }],
          evidence: "Staff profile",
        },
      ],
      total: 12,
    });

    const result = await api.entries.getConnections("ent_1");

    expect(fetchMock).toHaveBeenCalledWith("/api/entities/ent_1/connections");
    expect(result.total).toBe(12);
    expect(result.actors[0]).toEqual({
      id: "a1",
      name: "Marcus Lee",
      type: "person",
      slug: "marcus-lee",
      description_snippet: "Advocate",
      score: 4,
      strength: 80,
      tier: "moderate",
      reasons: [{ kind: "sourced_edge", label: "Staff profile", count: 1, source_id: "src_1" }],
      evidence: "Staff profile",
    });
  });
});
