import type {
  ActorQualityInfo,
  ConnectionNetwork,
  ConnectionReasonKind,
  ConnectionTier,
  Entry,
  EntryType,
  MapPoint,
  Source,
} from "./contracts";
import type {
  EntityDetailResponse,
  EntityResponse,
  MapPoint as MapPointResponse,
} from "./generated/atlas";

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function humanizeSentence(value: string): string {
  const label = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

export function firstDefinedString(...values: (string | null | undefined)[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim() !== "");
}

export function formatShortDate(value: string | null | undefined): string | undefined {
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

export function routeSegmentForEntryType(type: string): string {
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

export function mapSource(source: {
  id: string;
  url: string;
  title?: string | null;
  publication?: string | null;
  type?: string | null;
  extraction_method?: string | null;
  extraction_context?: string | null;
  linked_entity_ids?: string[] | null;
  linked_entities?: {
    id: string;
    issue_area_ids?: string[] | null;
    name: string;
    slug?: string | null;
    type: string;
  }[];
  freshness: {
    published_date?: string | null;
    ingested_at?: string | null;
    created_at?: string | null;
    last_seen?: string | null;
    last_verified?: string | null;
    latest_source_date?: string | null;
  };
}): Source {
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
      linked_atproto_handle: claim?.linked_atproto_handle ?? undefined,
      linked_atproto_did: claim?.linked_atproto_did ?? undefined,
      linked_atproto_verified_at: claim?.linked_atproto_verified_at ?? undefined,
      linked_atproto_status:
        claim?.linked_atproto_status === "verified" ||
        claim?.linked_atproto_status === "needs_attention"
          ? claim.linked_atproto_status
          : undefined,
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
    profile_url: entity.profile_url ?? undefined,
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

function requireMapNumber(value: number | undefined, field: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`Map point is missing ${field}`);
  }
  return value;
}

function mapConnectionNetwork(response: {
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
}): ConnectionNetwork {
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

export { actorWork, entityHref, mapConnectionNetwork, mapEntity, mapEntityDetail, mapMapPoint };
