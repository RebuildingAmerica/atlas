import type { BrowseSearchState } from "@/domains/catalog/search-state";
import type {
  EntryType,
  MapBounds,
  MapPointParams,
  SourcePattern,
  SourceType,
} from "@rebuildingamerica/atlas-api-client";

/**
 * Build the viewport query from the shared browse filters and the bounding box.
 *
 * The map and the browse list read the exact same facet vocabulary, so the same
 * `BrowseSearchState` that narrows the list narrows the dots — they can never
 * diverge. Only the bounding box is map-specific. An empty query string is
 * dropped rather than sent, so a blank search box isn't mistaken for a filter.
 *
 * @param search The shared browse filter state.
 * @param bounds The current viewport bounding box.
 * @returns The params for the `/api/entities/map` query.
 */
export function mapPointParamsFor(search: BrowseSearchState, bounds: MapBounds): MapPointParams {
  return {
    bounds,
    query: search.query ? search.query : undefined,
    states: search.states,
    cities: search.cities,
    regions: search.regions,
    issue_areas: search.issue_areas,
    entry_types: search.entry_types as EntryType[],
    source_types: search.source_types as SourceType[],
    source_patterns: search.source_patterns as SourcePattern[],
  };
}
