import type { Entry, EntryListResponse } from "@rebuildingamerica/atlas-api-client";

/**
 * Wraps entries in the envelope `api.entries.list` returns, so a seeded cache
 * looks exactly like a served response.
 *
 * @param entries - Entries the slice should contain.
 * @returns A complete `EntryListResponse`.
 */
export function createEntryListFixture(entries: Entry[]): EntryListResponse {
  return {
    data: entries,
    facets: {
      cities: [],
      entity_types: [],
      issue_areas: [],
      regions: [],
      source_patterns: [],
      source_types: [],
      states: [],
    },
    pagination: { has_more: false, limit: entries.length, offset: 0, total: entries.length },
  };
}
