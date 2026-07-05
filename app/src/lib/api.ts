import {
  getEntitiesMap,
  getEntity as getEntityRecord,
  getPlace,
  getPlaceIssueSignals,
  getPlacePageContext,
  getPlaceProfile,
  listEntities,
  listIssueAreas,
  listPlaceEntities,
  listPlaceSources,
  listPublicDirectories as listPublicDirectoryRecords,
  type EntityDetailResponse,
  type EntityResponse,
  type GetEntitiesMapParams,
  type GetPlacePageContextParams,
  type IssueSignalSummary,
  type ListEntitiesParams,
  type ListPlaceEntitiesParams,
  type ListPlaceSourcesParams,
  type MapPoint as MapPointResponse,
  type PlacePageContextResponse,
  type PlaceProfileResponse,
  type PublicDirectoryIndexResponse,
  type SourceResponse,
} from "@/lib/generated/atlas";
import { AtlasApiError, atlasFetch } from "@/lib/orval/fetcher";
import type {
  ActorQualityInfo,
  ConnectionNetwork,
  ConnectionReasonKind,
  ConnectionTier,
  DiscoveryRun,
  DiscoveryRunListResponse,
  Entry,
  EntryFilterParams,
  EntrySlugScope,
  EntryListResponse,
  EntryType,
  MapPoint,
  MapPointCollection,
  MapPointParams,
  PlaceActorList,
  PlaceActorParams,
  PlaceActorSummary,
  PlaceFact,
  PlaceGovernmentSummary,
  PlaceIdentity,
  PlaceIssueSummary,
  PlaceLatestItem,
  PlaceLatestList,
  PlaceLatestParams,
  PlacePageData,
  PlacePageParams,
  PlaceRelatedSummary,
  Source,
  TaxonomyResponse,
} from "@/types";

const TAXONOMY_PAGE_SIZE = 100;
const PLACE_LATEST_PAGE_SIZE = 10;

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
    linked_entity_ids: source.linked_entity_ids ?? [],
    linked_entities: (source.linked_entities ?? []).map((entity) => ({
      id: entity.id,
      name: entity.name,
      slug: entity.slug ?? null,
      type: entity.type,
    })),
    freshness: source.freshness as Source["freshness"],
    created_at: source.freshness.created_at ?? "",
  };
}

function mapActorQuality(entity: EntityResponse): ActorQualityInfo | undefined {
  const quality = entity.actor_quality;
  if (!quality) {
    return undefined;
  }
  if (typeof quality.score !== "number" || typeof quality.total !== "number") {
    throw new TypeError("Entity actor_quality is missing score or total");
  }
  return {
    level: quality.level as ActorQualityInfo["level"],
    score: quality.score,
    total: quality.total,
    present: quality.present ?? [],
    missing: quality.missing ?? [],
  };
}

function mapEntity(entity: EntityResponse): Entry {
  const claim = entity.claim;
  return {
    id: entity.id,
    type: entity.type as Entry["type"],
    name: entity.name,
    description: entity.description,
    custom_bio: entity.custom_bio ?? undefined,
    photo_url: entity.photo_url ?? undefined,
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
    preferred_contact_channel: entity.preferred_contact_channel ?? undefined,
    affiliated_org_id: entity.affiliated_org_id ?? undefined,
    active: entity.active,
    verified: entity.verified,
    last_verified: entity.freshness.last_verified ?? undefined,
    claim: {
      status: (claim?.status ?? "unclaimed") as Entry["claim"]["status"],
      claimed_by_user_id: claim?.claimed_by_user_id ?? undefined,
      claim_verified_at: claim?.claim_verified_at ?? undefined,
      verification_level: (claim?.verification_level ??
        "source-derived") as Entry["claim"]["verification_level"],
    },
    claim_evidence: entity.claim_evidence as Entry["claim_evidence"],
    profile_answers: entity.profile_answers,
    actor_quality: mapActorQuality(entity),
    trust: {
      level: (entity.trust?.level ?? "unverified") as Entry["trust"]["level"],
      independent_source_count: entity.trust?.independent_source_count ?? null,
      website_grounded: entity.trust?.website_grounded ?? null,
      email_grounded: entity.trust?.email_grounded ?? null,
    },
    issue_areas: entity.issue_area_ids ?? [],
    source_types: entity.source_types as Entry["source_types"],
    source_count: entity.source_count ?? 0,
    latest_source_date: entity.freshness.latest_source_date ?? undefined,
    slug: entity.slug ?? "",
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

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const WHOLE_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  style: "percent",
});

interface PlaceProfileFactSpec {
  block: "demographics" | "economics" | "education" | "health" | "housing";
  formatter: (value: number) => string;
  key: string;
  label: string;
}

const PLACE_PROFILE_FACTS: PlaceProfileFactSpec[] = [
  {
    block: "demographics",
    key: "population",
    label: "Population",
    formatter: (value) => WHOLE_NUMBER_FORMATTER.format(value),
  },
  {
    block: "economics",
    key: "median_household_income",
    label: "Median household income",
    formatter: (value) => CURRENCY_FORMATTER.format(value),
  },
  {
    block: "housing",
    key: "median_rent",
    label: "Median rent",
    formatter: (value) => CURRENCY_FORMATTER.format(value),
  },
  {
    block: "housing",
    key: "rent_burden_rate",
    label: "Rent-burdened households",
    formatter: (value) => PERCENT_FORMATTER.format(value),
  },
  {
    block: "health",
    key: "uninsured_rate",
    label: "Adults without health insurance",
    formatter: (value) => PERCENT_FORMATTER.format(value),
  },
  {
    block: "education",
    key: "bachelors_or_higher_rate",
    label: "Bachelor's degree or higher",
    formatter: (value) => PERCENT_FORMATTER.format(value),
  },
];

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstDefinedString(...values: (string | null | undefined)[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim() !== "");
}

function formatShortDate(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return SHORT_DATE_FORMATTER.format(parsed);
}

function mapPlaceFact(
  fact: NonNullable<PlacePageContextResponse["summary_facts"]>[number],
): PlaceFact {
  return {
    attribution: fact.attribution ?? undefined,
    label: fact.label,
    value: fact.value,
  };
}

function mapPlaceIdentity(slug: string, context: PlacePageContextResponse): PlaceIdentity {
  return {
    display: context.display,
    kind: context.kind,
    name: context.name,
    scopes: context.scopes ?? [],
    slug,
    sourceDataset: context.source_dataset ?? undefined,
    sourceIdentifier: context.source_identifier ?? undefined,
    sourceUrl: context.source_url ?? undefined,
  };
}

function mapPlaceGovernment(
  government: NonNullable<PlacePageContextResponse["governments"]>[number],
): PlaceGovernmentSummary {
  return {
    links: government.links ?? [],
    name: government.name,
    role: government.role,
  };
}

function mapRelatedPlace(
  place: NonNullable<PlacePageContextResponse["places"]>[number],
): PlaceRelatedSummary {
  return {
    accent: place.accent,
    href: place.href,
    kind: place.kind,
    latitude: place.latitude ?? undefined,
    longitude: place.longitude ?? undefined,
    name: place.name,
    sourceDataset: place.source_dataset ?? undefined,
    sourceIdentifier: place.source_identifier ?? undefined,
    sourceUrl: place.source_url ?? undefined,
    summary: place.summary,
  };
}

function provenanceAttribution(profile: PlaceProfileResponse | null): string | undefined {
  const first = profile?.provenance?.[0];
  if (!first) {
    return undefined;
  }
  const dataset = typeof first.dataset === "string" ? first.dataset : undefined;
  const publisher = typeof first.publisher === "string" ? first.publisher : undefined;
  const year =
    typeof first.year === "number" || typeof first.year === "string"
      ? String(first.year)
      : undefined;
  return [dataset ?? publisher, year].filter(Boolean).join(", ") || undefined;
}

function readNumericFact(block: Record<string, unknown> | undefined, key: string): number | null {
  const value = block?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function profileFacts(profile: PlaceProfileResponse | null): PlaceFact[] {
  if (!profile) {
    return [];
  }
  const attribution = provenanceAttribution(profile);
  return PLACE_PROFILE_FACTS.flatMap((spec) => {
    const value = readNumericFact(profile[spec.block], spec.key);
    if (value === null) {
      return [];
    }
    return [{ label: spec.label, value: spec.formatter(value), attribution }];
  });
}

function summaryFacts(context: PlacePageContextResponse, facts: PlaceFact[]): PlaceFact[] {
  const contextFacts = context.summary_facts?.map(mapPlaceFact) ?? [];
  if (contextFacts.length) {
    return contextFacts;
  }
  if (facts.length) {
    return facts.slice(0, 5);
  }
  return [];
}

function sourceAttribution(source: Source): string {
  const publisher = firstDefinedString(source.publication, humanize(source.type), source.title);
  const date = formatShortDate(source.published_date ?? source.freshness?.published_date);
  return [publisher, date].filter(Boolean).join(", ");
}

function routeSegmentForEntryType(type: string): string {
  const routeByType: Record<EntryType, string> = {
    campaign: "campaigns",
    event: "events",
    initiative: "initiatives",
    organization: "organizations",
    person: "people",
  };
  if (type in routeByType) {
    return routeByType[type as EntryType];
  }
  throw new TypeError(`Unsupported entry type: ${type}`);
}

function linkedEntityHref(entity: Source["linked_entities"][number]): string {
  if (!entity.slug) {
    return `/entries/${entity.id}`;
  }
  return `/profiles/${routeSegmentForEntryType(entity.type)}/${entity.slug}`;
}

function mapLatestItem(source: Source): PlaceLatestItem {
  const linkedEntityIds = source.linked_entity_ids;
  return {
    id: source.id,
    title: source.title ?? source.publication ?? source.url,
    attribution: sourceAttribution(source),
    dateLabel: formatShortDate(source.published_date ?? source.freshness?.published_date),
    href: source.url,
    excerpt: source.extraction_context,
    linkedActors: source.linked_entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      href: linkedEntityHref(entity),
    })),
    linkedEntityIds,
    sourceType: source.type,
    topics: [],
  };
}

function mapLatestList(response: Awaited<ReturnType<typeof listPlaceSources>>): PlaceLatestList {
  return {
    items: response.items?.map(mapSource).map(mapLatestItem) ?? [],
    nextCursor: response.next_cursor ?? undefined,
  };
}

function buildPlaceLatestParams(params: PlaceLatestParams = {}): ListPlaceSourcesParams {
  return {
    cursor: params.cursor,
    limit: params.limit ?? PLACE_LATEST_PAGE_SIZE,
    source_type: params.sourceTypes?.length ? params.sourceTypes : undefined,
    text: params.query || undefined,
  };
}

function buildPlaceActorParams(params: PlaceActorParams = {}): ListPlaceEntitiesParams {
  return {
    cursor: params.cursor,
    entity_type: params.type ? [params.type] : undefined,
    limit: params.limit ?? 20,
    sort: params.sort === "relevance" ? undefined : params.sort,
    text: params.query?.trim() || undefined,
  };
}

function buildPlaceContextParams(params: PlacePageParams = {}): GetPlacePageContextParams {
  return {
    kind: params.kind,
  };
}

function entityHref(entry: Entry): string {
  if (!entry.slug) {
    return `/entries/${entry.id}`;
  }
  return `/profiles/${routeSegmentForEntryType(entry.type)}/${entry.slug}`;
}

function actorWork(entry: Entry): string {
  if (entry.issue_areas.length) {
    return entry.issue_areas.slice(0, 3).map(humanize).join(", ");
  }
  return entry.description;
}

function mapPlaceActor(entry: Entry): PlaceActorSummary {
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

function mapPlaceIssue(issue: IssueSignalSummary): PlaceIssueSummary {
  return {
    id: issue.issue_area_id,
    name: issue.name,
    domain: issue.domain ?? undefined,
    actors: issue.top_entities?.slice(0, 4).map((entity) => entity.name) ?? [],
    places: [],
    records: issue.domain ? [humanize(issue.domain)] : [],
  };
}

async function loadPlaceProfile(placeSlug: string): Promise<PlaceProfileResponse | null> {
  try {
    return await getPlaceProfile(placeSlug);
  } catch (error) {
    if (error instanceof AtlasApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function getPlacePage(
  placeSlug: string,
  params: PlacePageParams = {},
): Promise<PlacePageData> {
  const contextRequest = params.kind
    ? getPlacePageContext(placeSlug, buildPlaceContextParams(params))
    : getPlacePageContext(placeSlug);
  const [, context, entities, issueSignals, profile, sources] = await Promise.all([
    getPlace(placeSlug),
    contextRequest,
    listPlaceEntities(placeSlug, { limit: 20 }),
    getPlaceIssueSignals(placeSlug),
    loadPlaceProfile(placeSlug),
    listPlaceSources(placeSlug, { limit: PLACE_LATEST_PAGE_SIZE }),
  ]);
  const facts = profileFacts(profile);
  const actorItems = entities.items?.map(mapEntity).map(mapPlaceActor) ?? [];

  return {
    identity: mapPlaceIdentity(placeSlug, context),
    summaryFacts: summaryFacts(context, facts),
    latest: mapLatestList(sources),
    actors: {
      items: actorItems,
      nextCursor: entities.next_cursor ?? undefined,
    },
    issues: issueSignals.issues?.map(mapPlaceIssue) ?? [],
    facts,
    governments: context.governments?.map(mapPlaceGovernment) ?? [],
    places: context.places?.map(mapRelatedPlace) ?? [],
  };
}

async function listPlaceLatest(
  placeSlug: string,
  params: PlaceLatestParams = {},
): Promise<PlaceLatestList> {
  const response = await listPlaceSources(placeSlug, buildPlaceLatestParams(params));
  return mapLatestList(response);
}

async function listPlaceActors(
  placeSlug: string,
  params: PlaceActorParams = {},
): Promise<PlaceActorList> {
  const response = await listPlaceEntities(placeSlug, buildPlaceActorParams(params));
  return {
    items: response.items?.map(mapEntity).map(mapPlaceActor) ?? [],
    nextCursor: response.next_cursor ?? undefined,
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
    source_pattern: filters.source_patterns,
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
      source_patterns: response.facets?.source_patterns ?? [],
    },
  };
}

async function getEntry(entryId: string): Promise<Entry> {
  return mapEntityDetail(await getEntityRecord(entryId));
}

/** Translate the internal viewport query into the generated map-endpoint params. */
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

function requireMapNumber(value: number | undefined, field: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`Map point is missing ${field}`);
  }
  return value;
}

/** Map one wire map point onto the internal, strongly-typed shape. */
function mapMapPoint(point: MapPointResponse): MapPoint {
  return {
    id: point.id,
    name: point.name,
    type: point.type as MapPoint["type"],
    slug: point.slug ?? null,
    place_label: point.place_label ?? null,
    geo_specificity: point.geo_specificity
      ? (point.geo_specificity as MapPoint["geo_specificity"])
      : null,
    geocode_precision: point.geocode_precision ?? null,
    geocode_source: point.geocode_source ?? null,
    lat: point.lat,
    lng: point.lng,
    issue_areas: point.issue_areas ?? [],
    source_count: requireMapNumber(point.source_count, "source_count"),
    latest_source_date: point.latest_source_date ?? null,
    trust_level: point.trust_level as MapPoint["trust_level"],
  };
}

/** Fetch placed people and groups inside a viewport, filtered by the browse facets. */
async function mapPoints(params: MapPointParams): Promise<MapPointCollection> {
  const response = await getEntitiesMap(buildMapPointParams(params));
  return {
    points: response.points?.map(mapMapPoint) ?? [],
    total: response.total,
    capped: response.capped,
  };
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

/** Raw connection-reason payload from the API. */
interface ConnectionReasonResponse {
  kind: string;
  label: string;
  count: number | null;
  source_id?: string | null;
}

/** Raw connected-actor payload from the API. */
interface ConnectedActorResponse {
  id: string;
  name: string;
  type: string;
  slug: string | null;
  description_snippet: string | null;
  score: number;
  strength: number;
  tier: string;
  reasons: ConnectionReasonResponse[];
  evidence: string;
}

/** Raw connections payload from the API. */
interface ConnectionsResponse {
  actors: ConnectedActorResponse[];
  total: number;
}

/** Resolve an entry by its type-prefixed slug (e.g., people/jane-doe-a3f2). */
async function getEntryBySlug(type: EntrySlugScope, slug: string): Promise<Entry> {
  const response = await atlasFetch<EntityDetailResponse>(`/api/entities/by-slug/${type}/${slug}`);
  return mapEntityDetail(response);
}

/** Map the raw connections payload into the internal ranked network. */
function mapConnectionNetwork(response: ConnectionsResponse): ConnectionNetwork {
  return {
    actors: response.actors.map((actor) => ({
      id: actor.id,
      name: actor.name,
      type: actor.type as Entry["type"],
      slug: actor.slug,
      description_snippet: actor.description_snippet,
      score: actor.score,
      strength: actor.strength,
      tier: actor.tier as ConnectionTier,
      reasons: actor.reasons.map((reason) => ({
        kind: reason.kind as ConnectionReasonKind,
        label: reason.label,
        count: reason.count,
        source_id: reason.source_id,
      })),
      evidence: actor.evidence,
    })),
    total: response.total,
  };
}

/** Fetch the ranked connection network for an entry. */
async function getConnections(entryId: string): Promise<ConnectionNetwork> {
  const response = await atlasFetch<ConnectionsResponse>(`/api/entities/${entryId}/connections`);
  return mapConnectionNetwork(response);
}

async function listPublicDirectories(): Promise<PublicDirectoryIndexResponse> {
  return listPublicDirectoryRecords();
}

export const api = {
  entries: {
    list: listEntries,
    get: getEntry,
    getBySlug: getEntryBySlug,
    getConnections,
    mapPoints,
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
  publicDirectories: {
    list: listPublicDirectories,
  },
  places: {
    getPage: getPlacePage,
    listActors: listPlaceActors,
    listLatest: listPlaceLatest,
  },
};
