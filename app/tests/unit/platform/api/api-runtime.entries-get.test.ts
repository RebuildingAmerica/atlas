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
    const entry = await api.entries.get("entity_123");
    expect(entry).toEqual(
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
        type: "initiative",
        website: undefined,
      }),
    );
    const [source] = entry.sources ?? [];
    expect(source).toBeDefined();
    if (!source) {
      throw new Error("Expected mapped source detail.");
    }
    expect(source).toEqual(
      expect.objectContaining({
        created_at: "2026-04-10T00:00:00.000Z",
        extraction_context: undefined,
        extraction_method: "manual",
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
        ingested_at: "2026-04-10T00:00:00.000Z",
        publication: undefined,
        published_date: undefined,
        title: undefined,
        type: "other",
        url: "https://atlas.test/source",
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
    const entry = await api.entries.get("entity_456");
    expect(entry).toEqual(
      expect.objectContaining({
        city: undefined,
        first_seen: "2026-04-10T00:00:00.000Z",
        issue_areas: [],
      }),
    );
    const [source] = entry.sources ?? [];
    expect(source).toBeDefined();
    if (!source) {
      throw new Error("Expected mapped source detail.");
    }
    expect(source).toEqual(
      expect.objectContaining({
        created_at: "",
        extraction_context: { stage: "capture" },
        extraction_method: "ocr",
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
        ingested_at: "2026-04-12T00:00:00.000Z",
        publication: "Atlas Weekly",
        published_date: "2026-04-11",
        title: "Remote update",
        type: "report",
        url: "https://atlas.test/source-456",
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
});
