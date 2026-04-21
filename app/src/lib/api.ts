import {
  getEntity as getEntityRecord,
  listEntities,
  listIssueAreas,
  type EntityDetailResponse,
  type EntityResponse,
  type ListEntitiesParams,
  type SourceResponse,
} from "@/lib/generated/atlas";
import type {
  DiscoveryRun,
  DiscoveryRunListResponse,
  Entry,
  EntryFilterParams,
  EntryListResponse,
  Source,
  TaxonomyResponse,
} from "@/types";

const TAXONOMY_PAGE_SIZE = 100;

function mapSource(source: SourceResponse): Source {
  return {
    id: source.id,
    url: source.url,
    title: source.title ?? undefined,
    publication: source.publication ?? undefined,
    published_date: source.freshness.published_date ?? undefined,
    type: (source.type ?? "other") as Source["type"],
    ingested_at: source.freshness.ingested_at ?? source.freshness.created_at ?? "",
    extraction_method: (source.extraction_method ?? "manual") as Source["extraction_method"],
    extraction_context: source.extraction_context ?? undefined,
    created_at: source.freshness.created_at ?? "",
  };
}

function mapEntity(entity: EntityResponse): Entry {
  return {
    id: entity.id,
    type: entity.type as Entry["type"],
    name: entity.name,
    description: entity.description,
    city: entity.address.city ?? undefined,
    state: entity.address.state ?? undefined,
    region: entity.address.region ?? undefined,
    geo_specificity: (entity.address.geo_specificity ?? "local") as Entry["geo_specificity"],
    full_address: entity.address.full_address ?? undefined,
    first_seen: entity.freshness.created_at ?? entity.created_at,
    last_seen: entity.freshness.last_seen ?? entity.updated_at,
    website: entity.contact.website ?? undefined,
    email: entity.contact.email ?? undefined,
    phone: entity.contact.phone ?? undefined,
    social_media: entity.contact.social_media ?? undefined,
    affiliated_org_id: entity.affiliated_org_id ?? undefined,
    active: entity.active,
    verified: entity.verified,
    last_verified: entity.freshness.last_verified ?? undefined,
    issue_areas: entity.issue_area_ids ?? [],
    source_types: entity.source_types as Entry["source_types"],
    source_count: entity.source_count ?? 0,
    latest_source_date: entity.freshness.latest_source_date ?? undefined,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  };
}

function mapEntityDetail(entity: EntityDetailResponse): Entry {
  return {
    ...mapEntity(entity),
    sources: entity.sources?.map(mapSource) ?? [],
  };
}

export function buildEntityListParams(filters: EntryFilterParams = {}): ListEntitiesParams {
  return {
    query: filters.query,
    state: filters.states,
    city: filters.cities,
    region: filters.regions,
    issue_area: filters.issue_areas,
    entity_type: filters.entry_types,
    source_type: filters.source_types,
    affiliated_org_id: filters.affiliated_org_id,
    limit: filters.limit,
    cursor: typeof filters.offset === "number" ? String(filters.offset) : undefined,
  };
}

async function listEntries(filters?: EntryFilterParams): Promise<EntryListResponse> {
  const response = await listEntities(buildEntityListParams(filters));
  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? 20;

  return {
    data: response.items?.map(mapEntity) ?? [],
    pagination: {
      limit,
      offset,
      total: response.total,
      has_more: response.next_cursor !== undefined && response.next_cursor !== null,
    },
    facets: {
      states: response.facets?.states ?? [],
      cities: response.facets?.cities ?? [],
      regions: response.facets?.regions ?? [],
      issue_areas: response.facets?.issue_areas ?? [],
      entity_types: response.facets?.entity_types ?? [],
      source_types: response.facets?.source_types ?? [],
    },
  };
}

async function getEntry(entryId: string): Promise<Entry> {
  return mapEntityDetail(await getEntityRecord(entryId));
}

async function listTaxonomy(): Promise<TaxonomyResponse> {
  const issues: NonNullable<Awaited<ReturnType<typeof listIssueAreas>>["items"]> = [];
  let cursor: string | undefined;

  do {
    const response = await listIssueAreas({ cursor, limit: TAXONOMY_PAGE_SIZE });
    issues.push(...(response.items ?? []));
    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return issues.reduce<TaxonomyResponse>((acc, issue) => {
    const bucket = acc[issue.domain] ?? [];
    bucket.push({
      slug: issue.slug,
      name: issue.name,
      description: issue.description,
    });
    acc[issue.domain] = bucket;
    return acc;
  }, {});
}

export const api = {
  entries: {
    list: listEntries,
    get: getEntry,
  },
  discovery: {
    list(): Promise<DiscoveryRunListResponse> {
      return Promise.resolve({ items: [], total: 0 });
    },
    get(_runId: string): Promise<DiscoveryRun> {
      return Promise.reject(new Error("Use the authenticated discovery server functions instead."));
    },
    start(_payload: unknown): Promise<DiscoveryRun> {
      return Promise.reject(new Error("Use the authenticated discovery server functions instead."));
    },
  },
  taxonomy: {
    list: listTaxonomy,
  },
};
