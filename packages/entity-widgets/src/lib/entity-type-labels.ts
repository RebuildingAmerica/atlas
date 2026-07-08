export type EntityType =
  | "person"
  | "organization"
  | "initiative"
  | "campaign"
  | "event";

/**
 * Human-readable labels for each `EntityType`.
 *
 * Shared by every component that renders an entity's type — `EntityCard`
 * and `SearchResultsList` alike — so the two widgets can't silently drift
 * on how an entity type is worded.
 */
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  person: "Person",
  organization: "Organization",
  initiative: "Initiative",
  campaign: "Campaign",
  event: "Event",
};

/** The subset of an entity payload needed to describe its type and location. */
export interface EntityTypeAndPlace {
  type: EntityType;
  /** Pre-formatted "City, State" display string, or null when unknown. */
  place_label: string | null;
}

/**
 * "Organization · Columbus, OH" — humanized type, then location when known.
 * `type` is always present, so the type label is never omitted; only the
 * location half is conditional, and no stray separator is ever rendered.
 */
export function formatEntityTypeAndPlace(entity: EntityTypeAndPlace): string {
  const typeLabel = ENTITY_TYPE_LABELS[entity.type];
  return entity.place_label
    ? `${typeLabel} · ${entity.place_label}`
    : typeLabel;
}
