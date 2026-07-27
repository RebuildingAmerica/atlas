import type { EntrySearchFacets } from "@rebuildingamerica/atlas-api-client";

/**
 * Builds the facet block a search reply carries, with every dimension empty
 * unless the test names it.
 *
 * @param overrides - Facet dimensions the test wants populated.
 * @returns A complete `EntrySearchFacets` block.
 */
export function homeFacets(overrides: Partial<EntrySearchFacets> = {}): EntrySearchFacets {
  return {
    cities: [],
    entity_types: [],
    issue_areas: [],
    regions: [],
    source_patterns: [],
    source_types: [],
    states: [],
    ...overrides,
  };
}
