/**
 * Shared fixture payloads shaped like Atlas's full `EntityResponse` (see
 * `api/atlas/domains/catalog/schemas/public.py`), reused across
 * `entity-card-data.test.ts`, `search-results-data.test.ts`, and
 * `connections-data.test.ts` — all three parse this same underlying shape
 * via `parseSearchResultRow` (`parse-entity-row.ts`), so one shared pair of
 * fixtures keeps their tests from drifting on what a "full" and "minimal"
 * entity payload looks like.
 */
export const FULL_ENTITY_PAYLOAD = {
  id: "e1",
  name: "Jane Doe",
  type: "person",
  description: "A civic organizer.",
  photo_url: "https://example.com/jane.jpg",
  address: { display: "Columbus, OH" },
  trust: { level: "atlas_verified" },
  source_count: 4,
  profile_url: "https://atlas.example.com/profiles/people/jane",
};

export const MINIMAL_ENTITY_PAYLOAD = {
  id: "e2",
  name: "Acme Org",
  type: "organization",
  source_count: 0,
};
