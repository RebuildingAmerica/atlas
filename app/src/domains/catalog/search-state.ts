import { z } from "zod";
import type { EntryType, SourceType } from "@/types";

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
  cityNames?: string[];
  entryTypeLabels?: Partial<Record<EntryType, string>>;
  issueAreaLabels: Record<string, string>;
  regionNames?: string[];
  sourceTypeLabels?: Partial<Record<SourceType, string>>;
  stateNameByCode: Record<string, string>;
}

export interface BrowseSearchIntent {
  cities: string[];
  entry_types: EntryType[];
  issue_areas: string[];
  query?: string;
  regions: string[];
  source_types: SourceType[];
  states: string[];
}

interface IntentCandidate<Value extends string> {
  caseSensitive?: boolean;
  label: string;
  value: Value;
}

interface IntentMatchResult<Value extends string> {
  matches: Value[];
  query: string;
}

const ISSUE_SYNONYMS: Partial<Record<string, string[]>> = {
  civic_participation: ["democracy", "voting", "voter access", "local elections"],
  healthcare_access: ["health care", "healthcare", "clinics", "medical access"],
  housing_affordability: [
    "renters",
    "rent",
    "tenant",
    "tenants",
    "tenant organizing",
    "tenant union",
  ],
  worker_power: ["labor", "worker", "workers", "union", "unions", "workplace organizing"],
};

const ENTRY_TYPE_SYNONYMS: Partial<Record<EntryType, string[]>> = {
  campaign: ["campaign", "campaigns"],
  event: ["event", "events"],
  initiative: ["initiative", "initiatives", "project", "projects"],
  organization: ["organization", "organizations", "org", "orgs", "group", "groups"],
  person: ["person", "people", "organizer", "organizers", "advocate", "advocates"],
};

const SOURCE_TYPE_SYNONYMS: Partial<Record<SourceType, string[]>> = {
  community_archive: ["community archive", "archive", "archives"],
  government_record: ["government record", "government records", "public record"],
  news_article: ["local news", "news article", "news", "article", "articles"],
  org_website: ["organization site", "organization website", "website", "websites"],
  podcast: ["podcast", "podcasts", "show", "shows"],
  report: ["report", "reports"],
  social_media: ["social media", "social"],
  video: ["video", "videos"],
};

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
    view: search.view ?? "list",
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
    .replace(/\b(in|near|for|about|around|on|from|with|by|of)\b/gi, " ")
    .replace(/[,\s]+/g, " ")
    .trim();

  return normalized || undefined;
}

function uniqueValues<Value extends string>(values: Value[]): Value[] {
  return [...new Set(values)];
}

function normalizedCandidates<Value extends string>(
  candidates: IntentCandidate<Value>[],
): IntentCandidate<Value>[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => candidate.label.trim().length > 0)
    .sort((left, right) => right.label.length - left.label.length)
    .filter((candidate) => {
      const key = `${candidate.value}:${candidate.label.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function matchCandidates<Value extends string>(
  rawQuery: string,
  candidates: IntentCandidate<Value>[],
): IntentMatchResult<Value> {
  let nextQuery = rawQuery;
  const matches: Value[] = [];

  normalizedCandidates(candidates).forEach((candidate) => {
    const flags = candidate.caseSensitive ? "" : "i";
    if (new RegExp(`\\b${escapeRegex(candidate.label)}\\b`, flags).test(nextQuery)) {
      matches.push(candidate.value);
      nextQuery = removePhrase(nextQuery, candidate.label);
    }
  });

  return {
    matches: uniqueValues(matches),
    query: nextQuery,
  };
}

function placeCandidates(values: string[]): IntentCandidate<string>[] {
  return values.map((value) => ({ label: value, value }));
}

function stateCandidates(stateNameByCode: Record<string, string>): IntentCandidate<string>[] {
  return Object.entries(stateNameByCode).flatMap(([code, name]) => [
    { label: name, value: code },
    { caseSensitive: true, label: code, value: code },
  ]);
}

function issueCandidates(issueAreaLabels: Record<string, string>): IntentCandidate<string>[] {
  return Object.entries(issueAreaLabels).flatMap(([slug, label]) => {
    const labelTerms = label.split(/\s+/).filter((term) => term.length > 3);
    const synonyms = ISSUE_SYNONYMS[slug] ?? [];
    return [label, labelTerms[0], slug.replaceAll("_", " "), ...synonyms]
      .filter((candidate): candidate is string => Boolean(candidate))
      .map((candidate) => ({ label: candidate, value: slug }));
  });
}

function entryTypeCandidates(
  labels: Partial<Record<EntryType, string>> = {},
): IntentCandidate<EntryType>[] {
  return (Object.entries(ENTRY_TYPE_SYNONYMS) as [EntryType, string[]][]).flatMap(
    ([entryType, synonyms]) =>
      [labels[entryType], ...synonyms]
        .filter((candidate): candidate is string => Boolean(candidate))
        .map((candidate) => ({ label: candidate, value: entryType })),
  );
}

function sourceTypeCandidates(
  labels: Partial<Record<SourceType, string>> = {},
): IntentCandidate<SourceType>[] {
  return (Object.entries(SOURCE_TYPE_SYNONYMS) as [SourceType, string[]][]).flatMap(
    ([sourceType, synonyms]) =>
      [labels[sourceType], ...synonyms]
        .filter((candidate): candidate is string => Boolean(candidate))
        .map((candidate) => ({ label: candidate, value: sourceType })),
  );
}

export function resolveBrowseSearchIntent(
  rawQuery: string,
  options: BrowseSearchIntentOptions,
): BrowseSearchIntent {
  let residualQuery = rawQuery.trim();
  const cityMatch = matchCandidates(residualQuery, placeCandidates(options.cityNames ?? []));
  residualQuery = cityMatch.query;

  const regionMatch = matchCandidates(residualQuery, placeCandidates(options.regionNames ?? []));
  residualQuery = regionMatch.query;

  const stateMatch = matchCandidates(residualQuery, stateCandidates(options.stateNameByCode));
  residualQuery = stateMatch.query;

  const issueMatch = matchCandidates(residualQuery, issueCandidates(options.issueAreaLabels));
  residualQuery = issueMatch.query;

  const entryTypeMatch = matchCandidates(
    residualQuery,
    entryTypeCandidates(options.entryTypeLabels),
  );
  residualQuery = entryTypeMatch.query;

  const sourceTypeMatch = matchCandidates(
    residualQuery,
    sourceTypeCandidates(options.sourceTypeLabels),
  );
  residualQuery = sourceTypeMatch.query;

  return {
    cities: cityMatch.matches,
    entry_types: entryTypeMatch.matches,
    issue_areas: issueMatch.matches,
    query: normalizeResidualQuery(residualQuery),
    regions: regionMatch.matches,
    source_types: sourceTypeMatch.matches,
    states: stateMatch.matches,
  };
}
