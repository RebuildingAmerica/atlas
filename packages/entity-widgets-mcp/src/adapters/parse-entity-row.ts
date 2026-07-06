import type {
  EntityType,
  SearchResultRow,
  TrustLevel,
} from "@rebuildingamerica/entity-widgets";

const ENTITY_TYPES: readonly EntityType[] = [
  "person",
  "organization",
  "initiative",
  "campaign",
  "event",
];

const TRUST_LEVELS: readonly TrustLevel[] = [
  "subject_verified",
  "atlas_verified",
  "corroborated",
  "unverified",
];

function isEntityType(value: unknown): value is EntityType {
  return (
    typeof value === "string" &&
    (ENTITY_TYPES as readonly string[]).includes(value)
  );
}

function isTrustLevel(value: unknown): value is TrustLevel {
  return (
    typeof value === "string" &&
    (TRUST_LEVELS as readonly string[]).includes(value)
  );
}

/** Returns `value[key]` as a plain record when it's a non-null object, else `null`. */
export function readNestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return typeof nested === "object" && nested !== null
    ? (nested as Record<string, unknown>)
    : null;
}

export function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const raw = value[key];
  return typeof raw === "string" ? raw : null;
}

/**
 * Defensively narrow an MCP tool's `structuredContent` payload — shaped like
 * Atlas's full `EntityResponse` (see `api/atlas/domains/catalog/schemas/public.py`)
 * — down to the `SearchResultRow` fields shared by every rendering of an
 * entity: identity, type, formatted location, trust tier, and source count.
 *
 * Shared by every widget in this package that renders an entity row —
 * `parseEntityCardData` (`entity-card-data.ts`), `parseSearchResultsData`
 * (`search-results-data.ts`), and `parseConnectionsData`
 * (`connections-data.ts`, via each related entity's nested `entity` field)
 * — so the three can never drift apart on the fields they share.
 *
 * Atlas's own MCP server is the only source for this payload in practice, so
 * this performs reasonable shape checks rather than full schema validation.
 * Returns `null` when the payload doesn't look like a usable entity record.
 */
export function parseSearchResultRow(value: unknown): SearchResultRow | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;

  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    !isEntityType(record.type)
  ) {
    return null;
  }
  if (typeof record.source_count !== "number") {
    return null;
  }

  const address = readNestedRecord(record, "address");
  const place_label = address ? readOptionalString(address, "display") : null;

  const trust = readNestedRecord(record, "trust");
  const trustLevelValue = trust ? trust.level : undefined;
  const trust_level: TrustLevel = isTrustLevel(trustLevelValue)
    ? trustLevelValue
    : "unverified";

  return {
    id: record.id,
    name: record.name,
    type: record.type,
    place_label,
    trust_level,
    source_count: record.source_count,
  };
}
