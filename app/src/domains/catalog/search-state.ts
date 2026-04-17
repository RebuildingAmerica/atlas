import { z } from "zod";

export const browseSearchSchema = z.object({
  query: z.string().optional(),
  view: z.enum(["map", "grid", "list"]).optional(),
  states: z.string().optional(),
  cities: z.string().optional(),
  regions: z.string().optional(),
  issue_areas: z.string().optional(),
  entry_types: z.string().optional(),
  source_types: z.string().optional(),
  offset: z.coerce.number().min(0).optional().catch(0),
});

export type BrowseRouteSearch = z.infer<typeof browseSearchSchema>;

export interface BrowseSearchState {
  query?: string;
  view: "map" | "grid" | "list";
  states: string[];
  cities: string[];
  regions: string[];
  issue_areas: string[];
  entry_types: string[];
  source_types: string[];
  offset: number;
}

export type BrowseFilterKey =
  | "states"
  | "cities"
  | "regions"
  | "issue_areas"
  | "entry_types"
  | "source_types";

export function parseList(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function serializeList(values: string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return values.join(",");
}

export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function buildBrowseSearch(search: BrowseRouteSearch): BrowseSearchState {
  return {
    query: search.query,
    view: search.view ?? "map",
    states: parseList(search.states),
    cities: parseList(search.cities),
    regions: parseList(search.regions),
    issue_areas: parseList(search.issue_areas),
    entry_types: parseList(search.entry_types),
    source_types: parseList(search.source_types),
    offset: search.offset ?? 0,
  };
}

export function hasActiveBrowseSearch(search: BrowseSearchState): boolean {
  return (
    Boolean(search.query) ||
    search.states.length > 0 ||
    search.cities.length > 0 ||
    search.regions.length > 0 ||
    search.issue_areas.length > 0 ||
    search.entry_types.length > 0 ||
    search.source_types.length > 0
  );
}
