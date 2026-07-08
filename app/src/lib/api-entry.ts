import {
  getEntitiesMap,
  getEntity as getEntityRecord,
  listEntities,
  type EntityDetailResponse,
  type GetEntitiesMapParams,
  type ListEntitiesParams,
} from "@/lib/generated/atlas";
import { atlasFetch } from "@/lib/orval/fetcher";
import type {
  ConnectionNetwork,
  Entry,
  EntryFilterParams,
  EntryListResponse,
  EntrySlugScope,
  MapPointCollection,
  MapPointParams,
} from "@/types";
import {
  actorWork,
  entityHref,
  firstDefinedString,
  formatShortDate,
  humanize,
  humanizeSentence,
  mapConnectionNetwork,
  mapEntity,
  mapEntityDetail,
  mapMapPoint,
  mapSource,
  routeSegmentForEntryType,
} from "@/lib/api-entry-mappers";

export function buildEntityListParams(filters: EntryFilterParams = {}): ListEntitiesParams {
  return {
    query: filters.query,
    state: filters.states,
    city: filters.cities,
    region: filters.regions,
    issue_area: filters.issue_areas,
    entity_type: filters.entry_types,
    source_type: filters.source_types,
    source_pattern: filters.source_patterns,
    affiliated_org_id: filters.affiliated_org_id,
    limit: filters.limit,
    cursor: typeof filters.offset === "number" ? String(filters.offset) : undefined,
  };
}

export function buildMapPointParams(params: MapPointParams): GetEntitiesMapParams {
  return {
    min_lng: params.bounds.minLng,
    min_lat: params.bounds.minLat,
    max_lng: params.bounds.maxLng,
    max_lat: params.bounds.maxLat,
    query: params.query,
    state: params.states,
    city: params.cities,
    region: params.regions,
    issue_area: params.issue_areas,
    entity_type: params.entry_types,
    source_type: params.source_types,
    source_pattern: params.source_patterns,
    limit: params.limit,
  };
}

export async function listEntries(filters?: EntryFilterParams): Promise<EntryListResponse> {
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
      source_patterns: response.facets?.source_patterns ?? [],
    },
  };
}

export async function getEntry(entryId: string): Promise<Entry> {
  return mapEntityDetail(await getEntityRecord(entryId));
}

export async function getEntryBySlug(type: EntrySlugScope, slug: string): Promise<Entry> {
  const response = await atlasFetch<EntityDetailResponse>(`/api/entities/by-slug/${type}/${slug}`);
  return mapEntityDetail(response);
}

export async function getConnections(entryId: string): Promise<ConnectionNetwork> {
  const response = await atlasFetch<{
    actors: {
      id: string;
      name: string;
      type: string;
      slug: string | null;
      description_snippet: string | null;
      score: number;
      strength: number;
      tier: string;
      reasons: {
        kind: string;
        label: string;
        count: number | null;
        source_id?: string | null;
      }[];
      evidence: string;
    }[];
    total: number;
  }>(`/api/entities/${entryId}/connections`);
  return mapConnectionNetwork(response);
}

export async function mapPoints(params: MapPointParams): Promise<MapPointCollection> {
  const response = await getEntitiesMap(buildMapPointParams(params));
  return {
    points: response.points?.map(mapMapPoint) ?? [],
    total: response.total,
    capped: response.capped,
  };
}

export function mapPlaceActor(entry: Entry) {
  return {
    id: entry.id,
    name: entry.name,
    type: entry.type,
    description: entry.description,
    href: entityHref(entry),
    work: actorWork(entry),
    latest: formatShortDate(entry.latest_source_date),
  };
}

export {
  humanize,
  humanizeSentence,
  firstDefinedString,
  formatShortDate,
  routeSegmentForEntryType,
  mapSource,
  mapEntity,
  mapEntityDetail,
  mapConnectionNetwork,
  mapMapPoint,
  entityHref,
  actorWork,
};
