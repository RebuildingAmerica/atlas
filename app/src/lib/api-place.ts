import {
  getPlace,
  getPlaceIssueSignals,
  getPlacePageContext,
  getPlaceProfile,
  listPlaceEntities,
  listPlaceSources,
  type GetPlacePageContextParams,
  type IssueSignalSummary,
  type ListPlaceEntitiesParams,
  type ListPlaceSourcesParams,
  type PlacePageContextResponse,
  type PlaceProfileResponse,
  type SourceResponse,
} from "@/lib/generated/atlas";
import type {
  PlaceActorList,
  PlaceActorParams,
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
} from "@/types";
import {
  mapEntity,
  mapPlaceActor,
  humanize,
  humanizeSentence,
  firstDefinedString,
  formatShortDate,
  routeSegmentForEntryType,
} from "@/lib/api-entry";

const PLACE_LATEST_PAGE_SIZE = 10;

const PLACE_PROFILE_FACTS: {
  block: "demographics" | "economics" | "education" | "health" | "housing";
  formatter: (value: number) => string;
  key: string;
  label: string;
}[] = [
  {
    block: "demographics",
    key: "population",
    label: "Population",
    formatter: (value) =>
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value),
  },
  {
    block: "economics",
    key: "median_household_income",
    label: "Median household income",
    formatter: (value) =>
      new Intl.NumberFormat("en-US", {
        currency: "USD",
        maximumFractionDigits: 0,
        style: "currency",
      }).format(value),
  },
  {
    block: "housing",
    key: "median_rent",
    label: "Median rent",
    formatter: (value) =>
      new Intl.NumberFormat("en-US", {
        currency: "USD",
        maximumFractionDigits: 0,
        style: "currency",
      }).format(value),
  },
  {
    block: "housing",
    key: "rent_burden_rate",
    label: "Rent-burdened households",
    formatter: (value) =>
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, style: "percent" }).format(value),
  },
  {
    block: "health",
    key: "uninsured_rate",
    label: "Adults without health insurance",
    formatter: (value) =>
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, style: "percent" }).format(value),
  },
  {
    block: "education",
    key: "bachelors_or_higher_rate",
    label: "Bachelor's degree or higher",
    formatter: (value) =>
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, style: "percent" }).format(value),
  },
];

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
      issue_area_ids: entity.issue_area_ids ?? [],
      name: entity.name,
      slug: entity.slug ?? null,
      type: entity.type,
    })),
    freshness: source.freshness as Source["freshness"],
    created_at: source.freshness.created_at ?? "",
  };
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

function linkedEntityHref(entity: Source["linked_entities"][number]): string {
  if (!entity.slug) {
    return `/entries/${entity.id}`;
  }
  return `/profiles/${routeSegmentForEntryType(entity.type)}/${entity.slug}`;
}

function latestTopics(source: Source): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  source.linked_entities.forEach((entity) => {
    entity.issue_area_ids.forEach((issueAreaId) => {
      if (seen.has(issueAreaId)) {
        return;
      }
      seen.add(issueAreaId);
      topics.push(humanizeSentence(issueAreaId));
    });
  });
  return topics;
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
    topics: latestTopics(source),
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
    kind: params.kind,
    limit: params.limit ?? PLACE_LATEST_PAGE_SIZE,
    source_type: params.sourceTypes?.length ? params.sourceTypes : undefined,
    text: params.query || undefined,
  };
}

function buildPlaceActorParams(params: PlaceActorParams = {}): ListPlaceEntitiesParams {
  return {
    cursor: params.cursor,
    entity_type: params.type ? [params.type] : undefined,
    kind: params.kind,
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

async function loadPlaceProfile(
  placeSlug: string,
  params: PlacePageParams = {},
): Promise<PlaceProfileResponse | null> {
  try {
    if (params.kind) {
      return await getPlaceProfile(placeSlug, buildPlaceContextParams(params));
    }
    return await getPlaceProfile(placeSlug);
  } catch (error) {
    if (error instanceof Error && (error as { status?: number }).status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getPlacePage(
  placeSlug: string,
  params: PlacePageParams = {},
): Promise<PlacePageData> {
  const contextRequest = params.kind
    ? getPlacePageContext(placeSlug, buildPlaceContextParams(params))
    : getPlacePageContext(placeSlug);
  const actorParams = buildPlaceActorParams({ kind: params.kind, limit: 20 });
  const issueRequest = params.kind
    ? getPlaceIssueSignals(placeSlug, buildPlaceContextParams(params))
    : getPlaceIssueSignals(placeSlug);
  const latestParams = buildPlaceLatestParams({ kind: params.kind, limit: PLACE_LATEST_PAGE_SIZE });
  const [, context, entities, issueSignals, profile, sources] = await Promise.all([
    getPlace(placeSlug),
    contextRequest,
    listPlaceEntities(placeSlug, actorParams),
    issueRequest,
    loadPlaceProfile(placeSlug, params),
    listPlaceSources(placeSlug, latestParams),
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

export async function listPlaceLatest(
  placeSlug: string,
  params: PlaceLatestParams = {},
): Promise<PlaceLatestList> {
  const response = await listPlaceSources(placeSlug, buildPlaceLatestParams(params));
  return mapLatestList(response);
}

export async function listPlaceActors(
  placeSlug: string,
  params: PlaceActorParams = {},
): Promise<PlaceActorList> {
  const response = await listPlaceEntities(placeSlug, buildPlaceActorParams(params));
  return {
    items: response.items?.map(mapEntity).map(mapPlaceActor) ?? [],
    nextCursor: response.next_cursor ?? undefined,
  };
}
