/** The kind of civic actor a card can represent. */
export type EntityType =
  "person" | "organization" | "initiative" | "campaign" | "event";

/**
 * Honest, never-overclaiming trust tier for an actor.
 *
 * Mirrors Atlas's canonical `trust.level` values one-for-one — see
 * `trust_tier()` in `api/atlas/domains/catalog/models/entry_model.py` and
 * `TrustInfo.level` in `api/atlas/domains/catalog/schemas/public.py` — so a
 * card can never show a stronger claim than the profile it links to.
 */
export type TrustLevel =
  "subject_verified" | "atlas_verified" | "corroborated" | "unverified";

/**
 * Minimal, presentation-only data shape for the compact entity card.
 *
 * This is deliberately decoupled from Atlas's full `EntityResponse` API
 * schema (`api/atlas/domains/catalog/schemas/public.py`) and from the main
 * app's internal `Entry` type (`app/src/types/entry.ts`): `app/` depends on
 * this package, not the other way around, so this type must not import from
 * either. Only the fields the compact card actually renders are included —
 * for example `issue_area_ids` and `claim.verification_level` exist on the
 * real API response but are omitted here because the card's layout doesn't
 * show them.
 *
 * The MCP tool result that feeds the widget build (wired up in a later,
 * separate task) carries the full nested `EntityResponse` shape; the
 * adapter in `src/adapters/app-client.ts` is responsible for narrowing that
 * down to this flat shape.
 */
export interface EntityCardData {
  id: string;
  name: string;
  type: EntityType;
  /** Plain-text summary; null when the entity has none yet. */
  description: string | null;
  /** Subject-uploaded photo or org logo; null renders a placeholder avatar. */
  photo_url: string | null;
  /** Pre-formatted "City, State" display string, from `address.display`. */
  place_label: string | null;
  trust_level: TrustLevel;
  source_count: number;
  /** Absolute URL to the full profile; omit the link entirely when null. */
  profile_url: string | null;
}

/**
 * Minimal, presentation-only data shape for one row in the compact
 * search-results list.
 *
 * A strict subset of `EntityCardData`'s identity/trust fields — no
 * `description`/`photo_url`/`profile_url`, since a dense list row doesn't
 * render any of them. `src/adapters/app-client.ts` parses both this shape
 * and `EntityCardData` from the same underlying MCP tool payload shape
 * (`EntityResponse`), sharing the parsing logic for the fields they have in
 * common so the two can't silently drift apart.
 */
export interface SearchResultRow {
  id: string;
  name: string;
  type: EntityType;
  /** Pre-formatted "City, State" display string, from `address.display`. */
  place_label: string | null;
  trust_level: TrustLevel;
  source_count: number;
}

/**
 * Presentation-only data shape for the whole search-results widget: one
 * page of rows plus enough pagination metadata for a "Showing N of TOTAL"
 * count and a "Load more" control.
 *
 * Mirrors Atlas's `EntityCollectionResponse`
 * (`api/atlas/domains/catalog/schemas/public.py`) narrowed down the same way
 * `EntityCardData` narrows `EntityResponse`: deliberately decoupled from
 * both that API schema and the main app's internal `Entry` type
 * (`app/src/types/entry.ts`), since `app/` depends on this package and not
 * the other way around. `place` (the resolved search place/address) is
 * omitted — this widget's list rows and count don't render it.
 */
export interface SearchResultsData {
  items: SearchResultRow[];
  total: number;
  /** Opaque pagination cursor for the next page; null when there isn't one. */
  next_cursor: string | null;
}

/**
 * One mechanically-derived relationship between two entities, as returned by
 * `get_related_entities` (`AtlasDataService.get_related_entities` in
 * `api/atlas/platform/mcp/data.py`; mirrors `EntityRelationship` in
 * `api/atlas/domains/catalog/schemas/public.py`).
 *
 * `type` is a plain string rather than a closed union: Atlas's relationship
 * taxonomy (`affiliated_organization`, `affiliated_member`,
 * `shared_issue_area`, `shared_place`, `shared_source` today) is defined
 * server-side and may grow, and `formatRelationshipLabel`
 * (`src/lib/relationship-labels.ts`) humanizes both known and unknown values
 * — so a new relationship type this client doesn't recognize yet still
 * renders a reasonable label instead of failing to parse.
 */
export interface ConnectionRelationship {
  type: string;
  /** Populated only for `shared_issue_area`; empty array for every other type. */
  issue_area_ids: string[];
  /** Populated only for `shared_source`; empty array for every other type. */
  source_ids: string[];
}

/**
 * One related entity plus every relationship it shares with the subject
 * entity `get_related_entities` was called for. A related entity can carry
 * more than one relationship simultaneously (e.g. both `shared_issue_area`
 * and `shared_place`), so this is a list, not a single value.
 *
 * `entity` reuses `SearchResultRow` — the same dense-row shape
 * `SearchResultsList` renders — rather than a third, near-duplicate entity
 * shape: `src/adapters/app-client.ts`'s `parseSearchResultRow` already
 * narrows the full MCP `EntityResponse` payload (the shape of each item's
 * `"entity"` field) down to exactly this shape.
 */
export interface ConnectionItem {
  entity: SearchResultRow;
  relationships: ConnectionRelationship[];
}

/**
 * Presentation-only data shape for the whole connections widget: one page of
 * related-entity rows plus enough pagination metadata for a "Showing N of
 * TOTAL" count and a "Load more" control — the same pagination shape as
 * `SearchResultsData`, plus `entity_id` (the subject entity these
 * connections are relative to; `useConnectionsData`'s `loadMore` re-sends it
 * as part of `get_related_entities`' original arguments, the same way
 * `useSearchResultsData`'s `loadMore` re-sends `search_entities`'s original
 * filter arguments).
 *
 * Mirrors Atlas's `EntityRelationshipsResponse`
 * (`api/atlas/domains/catalog/schemas/public.py`), deliberately decoupled
 * from both that API schema and the main app's internal `Entry` type the
 * same way `SearchResultsData` is.
 */
export interface ConnectionsData {
  entity_id: string;
  items: ConnectionItem[];
  total: number;
  /** Opaque pagination cursor for the next page; null when there isn't one. */
  next_cursor: string | null;
}
