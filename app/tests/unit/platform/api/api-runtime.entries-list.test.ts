import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEntity: vi.fn(),
  listEntities: vi.fn(),
  listIssueAreas: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-api-client/generated/atlas", () => ({
  getEntity: mocks.getEntity,
  listEntities: mocks.listEntities,
  listIssueAreas: mocks.listIssueAreas,
}));

describe("api runtime adapters", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getEntity.mockReset();
    mocks.listEntities.mockReset();
    mocks.listIssueAreas.mockReset();
  });

  it("maps entity collections into the browse surface shape", async () => {
    mocks.listEntities.mockResolvedValue({
      facets: {
        states: [{ count: 1, value: "MO" }],
      },
      items: [
        {
          active: true,
          address: {
            city: "Kansas City",
            display: "Kansas City, MO",
            full_address: null,
            geo_specificity: null,
            region: null,
            state: "MO",
          },
          affiliated_org_id: null,
          contact: {
            email: null,
            phone: "555-1111",
            social_media: null,
            website: "https://atlas.test/org",
          },
          created_at: "2026-04-10T00:00:00.000Z",
          description: "Housing group",
          freshness: {
            created_at: "2026-04-10T00:00:00.000Z",
            ingested_at: null,
            last_seen: null,
            last_verified: null,
            latest_source_date: null,
            published_date: null,
            staleness_reason: "Fresh",
            staleness_status: "fresh",
            updated_at: "2026-04-10T00:00:00.000Z",
          },
          id: "entity_123",
          issue_area_ids: ["housing_affordability"],
          name: "Housing Justice KC",
          resource_uri: "atlas://entities/entity_123",
          source_count: null,
          source_types: ["news_article"],
          type: "organization",
          updated_at: "2026-04-10T00:00:00.000Z",
          verified: true,
        },
      ],
      next_cursor: "20",
      total: 1,
    });

    const { api } = await import("@rebuildingamerica/atlas-api-client");
    const result = await api.entries.list({
      limit: 20,
      offset: 20,
      query: "housing",
    });

    expect(mocks.listEntities).toHaveBeenCalledWith({
      city: undefined,
      cursor: "20",
      entity_type: undefined,
      issue_area: undefined,
      limit: 20,
      query: "housing",
      region: undefined,
      source_type: undefined,
      state: undefined,
    });
    expect(result).toEqual({
      data: [
        {
          active: true,
          actor_quality: undefined,
          affiliated_org_id: undefined,
          city: "Kansas City",
          claim: {
            claim_verified_at: undefined,
            claimed_by_user_id: undefined,
            status: "unclaimed",
            verification_level: "source-derived",
          },
          claim_evidence: undefined,
          created_at: "2026-04-10T00:00:00.000Z",
          custom_bio: undefined,
          description: "Housing group",
          email: undefined,
          first_seen: "2026-04-10T00:00:00.000Z",
          full_address: undefined,
          geo_specificity: "local",
          id: "entity_123",
          issue_areas: ["housing_affordability"],
          last_seen: "2026-04-10T00:00:00.000Z",
          last_verified: undefined,
          latest_source_date: undefined,
          name: "Housing Justice KC",
          phone: "555-1111",
          photo_url: undefined,
          preferred_contact_channel: undefined,
          profile_answers: undefined,
          region: undefined,
          social_media: undefined,
          source_count: 0,
          slug: "",
          source_types: ["news_article"],
          state: "MO",
          trust: {
            level: "unverified",
            independent_source_count: null,
            website_grounded: null,
            email_grounded: null,
          },
          type: "organization",
          updated_at: "2026-04-10T00:00:00.000Z",
          verified: true,
          website: "https://atlas.test/org",
        },
      ],
      facets: {
        cities: [],
        entity_types: [],
        issue_areas: [],
        regions: [],
        source_patterns: [],
        source_types: [],
        states: [{ count: 1, value: "MO" }],
      },
      pagination: {
        has_more: true,
        limit: 20,
        offset: 20,
        total: 1,
      },
    });
  });

  it("returns empty collection defaults when Atlas has no list results", async () => {
    mocks.listEntities.mockResolvedValue({
      facets: null,
      items: undefined,
      next_cursor: null,
      total: 0,
    });

    const { api } = await import("@rebuildingamerica/atlas-api-client");
    await expect(api.entries.list()).resolves.toEqual({
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
    });
  });
});
