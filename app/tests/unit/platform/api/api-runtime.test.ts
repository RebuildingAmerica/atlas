import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEntity: vi.fn(),
  listEntities: vi.fn(),
  listIssueAreas: vi.fn(),
}));

vi.mock("@/lib/generated/atlas", () => ({
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

    const { api } = await import("@/lib/api");
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
          affiliated_org_id: undefined,
          city: "Kansas City",
          created_at: "2026-04-10T00:00:00.000Z",
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
          region: undefined,
          social_media: undefined,
          source_count: 0,
          slug: "",
          source_types: ["news_article"],
          state: "MO",
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

    const { api } = await import("@/lib/api");
    await expect(api.entries.list()).resolves.toEqual({
      data: [],
      facets: {
        cities: [],
        entity_types: [],
        issue_areas: [],
        regions: [],
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

  it("maps entity detail sources into the legacy entry shape", async () => {
    mocks.getEntity.mockResolvedValue({
      active: true,
      address: {
        city: "Kansas City",
        display: "Kansas City, MO",
        full_address: "123 Main St, Kansas City, MO 64106",
        geo_specificity: "local",
        region: "Midwest",
        state: "MO",
      },
      affiliated_org_id: "org_123",
      contact: {
        email: "operator@atlas.test",
        phone: null,
        social_media: { instagram: "@atlas" },
        website: null,
      },
      created_at: "2026-04-10T00:00:00.000Z",
      description: "Community project",
      freshness: {
        created_at: "2026-04-10T00:00:00.000Z",
        ingested_at: null,
        last_seen: "2026-04-12T00:00:00.000Z",
        last_verified: "2026-04-13T00:00:00.000Z",
        latest_source_date: "2026-04-11",
        published_date: null,
        staleness_reason: "Fresh",
        staleness_status: "fresh",
        updated_at: "2026-04-12T00:00:00.000Z",
      },
      id: "entity_123",
      issue_area_ids: ["housing_affordability"],
      name: "Atlas Community Project",
      resource_uri: "atlas://entities/entity_123",
      source_count: 1,
      source_types: ["report"],
      sources: [
        {
          extraction_context: null,
          extraction_method: null,
          flag_summary: {},
          freshness: {
            created_at: "2026-04-10T00:00:00.000Z",
            ingested_at: null,
            last_seen: null,
            last_verified: null,
            latest_source_date: null,
            published_date: null,
            staleness_reason: "Fresh",
            staleness_status: "fresh",
            updated_at: null,
          },
          id: "source_123",
          linked_entity_ids: ["entity_123"],
          publication: null,
          resource_uri: "atlas://sources/source_123",
          title: null,
          type: null,
          url: "https://atlas.test/source",
        },
      ],
      type: "initiative",
      updated_at: "2026-04-12T00:00:00.000Z",
      verified: true,
    });

    const { api } = await import("@/lib/api");
    await expect(api.entries.get("entity_123")).resolves.toEqual(
      expect.objectContaining({
        affiliated_org_id: "org_123",
        city: "Kansas City",
        email: "operator@atlas.test",
        first_seen: "2026-04-10T00:00:00.000Z",
        full_address: "123 Main St, Kansas City, MO 64106",
        geo_specificity: "local",
        last_seen: "2026-04-12T00:00:00.000Z",
        last_verified: "2026-04-13T00:00:00.000Z",
        latest_source_date: "2026-04-11",
        region: "Midwest",
        social_media: { instagram: "@atlas" },
        sources: [
          {
            created_at: "2026-04-10T00:00:00.000Z",
            extraction_context: undefined,
            extraction_method: "manual",
            id: "source_123",
            ingested_at: "2026-04-10T00:00:00.000Z",
            publication: undefined,
            published_date: undefined,
            title: undefined,
            type: "other",
            url: "https://atlas.test/source",
          },
        ],
        type: "initiative",
        website: undefined,
      }),
    );
  });

  it("falls back for missing entity detail fields and source freshness metadata", async () => {
    mocks.getEntity.mockResolvedValue({
      active: true,
      address: {
        city: null,
        display: "Remote",
        full_address: null,
        geo_specificity: null,
        region: "Remote",
        state: "US",
      },
      affiliated_org_id: null,
      contact: {
        email: null,
        phone: null,
        social_media: null,
        website: null,
      },
      created_at: "2026-04-10T00:00:00.000Z",
      description: "Distributed mutual aid network",
      freshness: {
        created_at: null,
        ingested_at: null,
        last_seen: null,
        last_verified: null,
        latest_source_date: null,
        published_date: null,
        staleness_reason: "Fresh",
        staleness_status: "fresh",
        updated_at: null,
      },
      id: "entity_456",
      issue_area_ids: null,
      name: "Atlas Remote Network",
      resource_uri: "atlas://entities/entity_456",
      source_count: 2,
      source_types: ["report"],
      sources: [
        {
          extraction_context: { stage: "capture" },
          extraction_method: "ocr",
          flag_summary: {},
          freshness: {
            created_at: null,
            ingested_at: "2026-04-12T00:00:00.000Z",
            last_seen: null,
            last_verified: null,
            latest_source_date: null,
            published_date: "2026-04-11",
            staleness_reason: "Fresh",
            staleness_status: "fresh",
            updated_at: null,
          },
          id: "source_456",
          linked_entity_ids: ["entity_456"],
          publication: "Atlas Weekly",
          resource_uri: "atlas://sources/source_456",
          title: "Remote update",
          type: "report",
          url: "https://atlas.test/source-456",
        },
      ],
      type: "initiative",
      updated_at: "2026-04-12T00:00:00.000Z",
      verified: true,
    });

    const { api } = await import("@/lib/api");
    await expect(api.entries.get("entity_456")).resolves.toEqual(
      expect.objectContaining({
        city: undefined,
        first_seen: "2026-04-10T00:00:00.000Z",
        issue_areas: [],
        sources: [
          {
            created_at: "",
            extraction_context: { stage: "capture" },
            extraction_method: "ocr",
            id: "source_456",
            ingested_at: "2026-04-12T00:00:00.000Z",
            publication: "Atlas Weekly",
            published_date: "2026-04-11",
            title: "Remote update",
            type: "report",
            url: "https://atlas.test/source-456",
          },
        ],
      }),
    );
  });

  it("returns an empty source list when entity details omit expanded sources", async () => {
    mocks.getEntity.mockResolvedValue({
      active: true,
      address: {
        city: "St. Louis",
        display: "St. Louis, MO",
        full_address: null,
        geo_specificity: "local",
        region: null,
        state: "MO",
      },
      affiliated_org_id: null,
      contact: {
        email: null,
        phone: null,
        social_media: null,
        website: null,
      },
      created_at: "2026-04-10T00:00:00.000Z",
      description: "No expanded sources yet",
      freshness: {
        created_at: "2026-04-10T00:00:00.000Z",
        ingested_at: null,
        last_seen: null,
        last_verified: null,
        latest_source_date: null,
        published_date: null,
        staleness_reason: "Fresh",
        staleness_status: "fresh",
        updated_at: null,
      },
      id: "entity_789",
      issue_area_ids: [],
      name: "Atlas Local Team",
      resource_uri: "atlas://entities/entity_789",
      source_count: 0,
      source_types: [],
      sources: undefined,
      type: "organization",
      updated_at: "2026-04-12T00:00:00.000Z",
      verified: true,
    });

    const { api } = await import("@/lib/api");
    await expect(api.entries.get("entity_789")).resolves.toMatchObject({
      id: "entity_789",
      sources: [],
    });
  });

  it("falls back when source ingestion and entity address metadata are missing", async () => {
    mocks.getEntity.mockResolvedValue({
      active: true,
      address: {
        city: "Anywhere",
        display: "Anywhere",
        full_address: null,
        geo_specificity: "regional",
        region: null,
        state: null,
      },
      affiliated_org_id: null,
      contact: {
        email: null,
        phone: null,
        social_media: null,
        website: null,
      },
      created_at: "2026-04-10T00:00:00.000Z",
      description: "No ingestion metadata yet",
      freshness: {
        created_at: "2026-04-10T00:00:00.000Z",
        ingested_at: null,
        last_seen: null,
        last_verified: null,
        latest_source_date: null,
        published_date: null,
        staleness_reason: "Fresh",
        staleness_status: "fresh",
        updated_at: null,
      },
      id: "entity_999",
      issue_area_ids: [],
      name: "Atlas Anywhere",
      resource_uri: "atlas://entities/entity_999",
      source_count: 1,
      source_types: ["report"],
      sources: [
        {
          extraction_context: null,
          extraction_method: null,
          flag_summary: {},
          freshness: {
            created_at: null,
            ingested_at: null,
            last_seen: null,
            last_verified: null,
            latest_source_date: null,
            published_date: null,
            staleness_reason: "Fresh",
            staleness_status: "fresh",
            updated_at: null,
          },
          id: "source_999",
          linked_entity_ids: ["entity_999"],
          publication: null,
          resource_uri: "atlas://sources/source_999",
          title: null,
          type: "report",
          url: "https://atlas.test/source-999",
        },
      ],
      type: "initiative",
      updated_at: "2026-04-12T00:00:00.000Z",
      verified: true,
    });

    const { api } = await import("@/lib/api");
    await expect(api.entries.get("entity_999")).resolves.toMatchObject({
      id: "entity_999",
      sources: [
        expect.objectContaining({
          created_at: "",
          ingested_at: "",
        }),
      ],
      state: undefined,
    });
  });

  it("keeps discovery reads and writes routed through authenticated server functions", async () => {
    const { api } = await import("@/lib/api");

    await expect(api.discovery.list()).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(api.discovery.get("run_123")).rejects.toThrow(
      "Use the authenticated discovery server functions instead.",
    );
    await expect(api.discovery.start({})).rejects.toThrow(
      "Use the authenticated discovery server functions instead.",
    );
  });
});
