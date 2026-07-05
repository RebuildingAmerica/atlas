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

import { api, buildEntityListParams, buildMapPointParams } from "@/lib/api";
import { atlasFetch } from "@/lib/orval/fetcher";
import { CONUS_BOUNDS } from "../../../fixtures/catalog/map";

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
        source_patterns: ["multi_source"],
        affiliated_org_id: "org_123",
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
      source_pattern: ["multi_source"],
      affiliated_org_id: "org_123",
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
      source_pattern: undefined,
      affiliated_org_id: undefined,
      limit: undefined,
      cursor: undefined,
    });
  });
});

describe("buildMapPointParams", () => {
  it("maps the viewport query onto the generated map-endpoint params", () => {
    expect(
      buildMapPointParams({
        bounds: CONUS_BOUNDS,
        query: "housing",
        states: ["MO", "KS"],
        cities: ["Kansas City"],
        regions: ["Midwest"],
        issue_areas: ["housing_affordability"],
        entry_types: ["organization"],
        source_types: ["news_article"],
        source_patterns: ["multi_source"],
        limit: 1500,
      }),
    ).toEqual({
      min_lng: -125,
      min_lat: 24,
      max_lng: -66.5,
      max_lat: 49.5,
      query: "housing",
      state: ["MO", "KS"],
      city: ["Kansas City"],
      region: ["Midwest"],
      issue_area: ["housing_affordability"],
      entity_type: ["organization"],
      source_type: ["news_article"],
      source_pattern: ["multi_source"],
      limit: 1500,
    });
  });

  it("leaves the facet filters undefined when only a bounding box is given", () => {
    expect(buildMapPointParams({ bounds: CONUS_BOUNDS })).toEqual({
      min_lng: -125,
      min_lat: 24,
      max_lng: -66.5,
      max_lat: 49.5,
      query: undefined,
      state: undefined,
      city: undefined,
      region: undefined,
      issue_area: undefined,
      entity_type: undefined,
      source_type: undefined,
      source_pattern: undefined,
      limit: undefined,
    });
  });
});

describe("api.entries.mapPoints", () => {
  beforeEach(() => {
    mapMocks.getEntitiesMap.mockReset();
  });

  it("requests the viewport and maps every placed actor onto the internal shape", async () => {
    mapMocks.getEntitiesMap.mockResolvedValueOnce({
      points: [
        {
          id: "ent_1",
          name: "Prairie Housing Trust",
          type: "organization",
          slug: "prairie-housing-trust-1",
          place_label: "Kansas City, MO",
          geo_specificity: "local",
          geocode_precision: "city",
          geocode_source: "gazetteer",
          lat: 39.1,
          lng: -94.6,
          issue_areas: ["housing_affordability"],
          source_count: 2,
          latest_source_date: "2026-05-04",
          trust_level: "corroborated",
        },
      ],
      total: 1,
      capped: false,
    });

    const result = await api.entries.mapPoints({
      bounds: CONUS_BOUNDS,
      issue_areas: ["housing_affordability"],
    });

    expect(mapMocks.getEntitiesMap).toHaveBeenCalledWith(
      expect.objectContaining({
        min_lng: -125,
        max_lat: 49.5,
        issue_area: ["housing_affordability"],
      }),
    );
    expect(result).toEqual({
      points: [
        {
          id: "ent_1",
          name: "Prairie Housing Trust",
          type: "organization",
          slug: "prairie-housing-trust-1",
          place_label: "Kansas City, MO",
          geo_specificity: "local",
          geocode_precision: "city",
          geocode_source: "gazetteer",
          lat: 39.1,
          lng: -94.6,
          issue_areas: ["housing_affordability"],
          source_count: 2,
          latest_source_date: "2026-05-04",
          trust_level: "corroborated",
        },
      ],
      total: 1,
      capped: false,
    });
  });

  it("defaults the slug to null and issue areas to an empty list when the API omits them", async () => {
    mapMocks.getEntitiesMap.mockResolvedValueOnce({
      points: [
        {
          id: "ent_2",
          name: "Jane Organizer",
          type: "person",
          slug: null,
          place_label: null,
          geo_specificity: null,
          geocode_precision: null,
          geocode_source: null,
          lat: 30.3,
          lng: -97.7,
          source_count: 0,
          latest_source_date: null,
          trust_level: "unverified",
        },
      ],
      total: 1,
      capped: false,
    });

    const result = await api.entries.mapPoints({ bounds: CONUS_BOUNDS });

    expect(result.points[0]).toEqual({
      id: "ent_2",
      name: "Jane Organizer",
      type: "person",
      slug: null,
      place_label: null,
      geo_specificity: null,
      geocode_precision: null,
      geocode_source: null,
      lat: 30.3,
      lng: -97.7,
      issue_areas: [],
      source_count: 0,
      latest_source_date: null,
      trust_level: "unverified",
    });
  });

  it("returns an empty collection when the viewport carries no points field", async () => {
    mapMocks.getEntitiesMap.mockResolvedValueOnce({ total: 0, capped: false });

    const result = await api.entries.mapPoints({ bounds: CONUS_BOUNDS });

    expect(result).toEqual({ points: [], total: 0, capped: false });
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
    expect(result.actor_quality).toEqual({
      level: "specific_actor",
      score: 5,
      total: 5,
      present: ["actor", "work", "place", "issues", "sources"],
      missing: [],
    });
    // Trust defaults to an honest "unverified" with unknown grounding when the API omits it.
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
