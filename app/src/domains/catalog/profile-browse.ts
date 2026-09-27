import {
  buildBrowseSearch,
  type BrowseRouteSearch,
} from "@rebuildingamerica/atlas-catalog/search-state";
import type {
  EntryFilterParams,
  EntryType,
  SourcePattern,
  SourceType,
} from "@rebuildingamerica/atlas-api-client";

export type ProfileBrowseScope = "all" | "people" | "organizations";

export function lockedEntryTypesForScope(scope: ProfileBrowseScope): EntryType[] {
  if (scope === "people") {
    return ["person"];
  }

  if (scope === "organizations") {
    return ["organization"];
  }

  return ["person", "organization"];
}

/** Match the directory's server response to the browser's locked-type query. */
export function buildProfileDirectoryFilters(
  search: BrowseRouteSearch,
  entryType: "person" | "organization",
): EntryFilterParams {
  const filters = buildBrowseSearch(search);

  return {
    cities: filters.cities,
    entry_types: [entryType],
    issue_areas: filters.issue_areas,
    limit: 20,
    offset: filters.offset,
    query: filters.query,
    regions: filters.regions,
    source_patterns: filters.source_patterns as SourcePattern[],
    source_types: filters.source_types as SourceType[],
    states: filters.states,
  };
}
