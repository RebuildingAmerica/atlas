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
  source_patterns: z.string().optional(),
  offset: z.coerce.number().min(0).optional().catch(0),
});

export type BrowseRouteSearch = z.infer<typeof browseSearchSchema>;

/**
 * The map route's search: every browse filter, plus the viewport (`z/lat/lng`)
 * so a shared `/map` link restores both the filters and the camera position.
 */
export const mapSearchSchema = browseSearchSchema.extend({
  z: z.coerce.number().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});

export type MapRouteSearch = z.infer<typeof mapSearchSchema>;

export interface BrowseSearchState {
  query?: string;
  view: "map" | "grid" | "list";
  states: string[];
  cities: string[];
  regions: string[];
  issue_areas: string[];
  entry_types: string[];
  source_types: string[];
  source_patterns: string[];
  offset: number;
}

export type BrowseFilterKey =
  | "states"
  | "cities"
  | "regions"
  | "issue_areas"
  | "entry_types"
  | "source_types"
  | "source_patterns";

export interface BrowseSearchIntentOptions {
  issueAreaLabels: Record<string, string>;
  stateNameByCode: Record<string, string>;
}

export interface BrowseSearchIntent {
  issue_areas: string[];
  query?: string;
  states: string[];
}

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
    source_patterns: parseList(search.source_patterns),
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
    search.source_types.length > 0 ||
    search.source_patterns.length > 0
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removePhrase(value: string, phrase: string): string {
  return value
    .replace(new RegExp(`\\b${escapeRegex(phrase)}\\b`, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeResidualQuery(value: string): string | undefined {
  const normalized = value
    .replace(/\b(in|near|for|about|around|on)\b/gi, " ")
    .replace(/[,\s]+/g, " ")
    .trim();

  return normalized || undefined;
}

export function resolveBrowseSearchIntent(
  rawQuery: string,
  options: BrowseSearchIntentOptions,
): BrowseSearchIntent {
  let residualQuery = rawQuery.trim();
  const states: string[] = [];
  const issueAreas: string[] = [];

  Object.entries(options.stateNameByCode).forEach(([code, name]) => {
    if (new RegExp(`\\b${escapeRegex(name)}\\b`, "i").test(residualQuery)) {
      states.push(code);
      residualQuery = removePhrase(residualQuery, name);
    }
  });

  Object.entries(options.issueAreaLabels).forEach(([slug, label]) => {
    const labelTerms = label.split(/\s+/).filter((term) => term.length > 3);
    const candidates = [label, labelTerms[0], slug.replaceAll("_", " ")].filter(
      (candidate): candidate is string => Boolean(candidate),
    );

    if (
      candidates.some((candidate) =>
        new RegExp(`\\b${escapeRegex(candidate)}\\b`, "i").test(residualQuery),
      )
    ) {
      issueAreas.push(slug);
      candidates.forEach((candidate) => {
        residualQuery = removePhrase(residualQuery, candidate);
      });
    }
  });

  return {
    issue_areas: issueAreas,
    query: normalizeResidualQuery(residualQuery),
    states,
  };
}
