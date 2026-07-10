import { humanize } from "@/domains/catalog/catalog";
import { STATE_NAME_BY_CODE } from "@/domains/catalog/us-state-grid";
import type { BrowseFilterKey } from "@/domains/catalog/search-state";
import type { Entry, EntryListResponse, EntryType, FacetOption } from "@/types";

export interface BrowseEditorialFacet {
  actorCount?: number;
  count: number;
  detail?: string;
  evidenceCount?: number;
  featuredActor?: string;
  filterKey: BrowseFilterKey;
  label: string;
  latestSourceDate?: string;
  placeCount?: number;
  summary?: string;
  value: string;
}

export interface BrowseEditorialSections {
  activeIssues: BrowseEditorialFacet[];
  activePlaces: BrowseEditorialFacet[];
  entriesByType: Record<EntryType, Entry[]>;
}

interface BuildBrowseEditorialSectionsInput {
  issueAreaLabels: Record<string, string>;
  response: EntryListResponse | undefined;
}

const MAX_SHELF_ITEMS = 8;
const MAX_ENTRY_ITEMS = 8;
const ENTRY_TYPE_ORDER: EntryType[] = ["organization", "person", "initiative", "campaign", "event"];

function sortFacets(facets: FacetOption[] | undefined): FacetOption[] {
  return [...(facets ?? [])].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return left.value.localeCompare(right.value);
  });
}

function sortEntriesForPrimitiveSection(entries: Entry[]): Entry[] {
  return [...entries]
    .sort((left, right) => {
      if (right.source_count !== left.source_count) {
        return right.source_count - left.source_count;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, MAX_ENTRY_ITEMS);
}

function entryPlaceLabel(entry: Entry): string | undefined {
  const state = entry.state ? (STATE_NAME_BY_CODE[entry.state] ?? entry.state) : undefined;
  if (entry.city && state) {
    return `${entry.city}, ${state}`;
  }
  return entry.city ?? state ?? entry.region;
}

function issueFacetDetail(issueValue: string, entries: Entry[]): string | undefined {
  const featuredEntry = featuredEntryForIssue(issueValue, entries);
  return featuredEntry ? entryPlaceLabel(featuredEntry) : undefined;
}

function entriesForIssue(issueValue: string, entries: Entry[]): Entry[] {
  return entries.filter(
    (entry) => Array.isArray(entry.issue_areas) && entry.issue_areas.includes(issueValue),
  );
}

function featuredEntryForIssue(issueValue: string, entries: Entry[]): Entry | undefined {
  return sortEntriesForPrimitiveSection(entriesForIssue(issueValue, entries))[0];
}

function evidenceCountForIssue(issueValue: string, entries: Entry[]): number | undefined {
  const count = entriesForIssue(issueValue, entries).reduce(
    (total, entry) => total + entry.source_count,
    0,
  );

  return count > 0 ? count : undefined;
}

function latestSourceDateForIssue(issueValue: string, entries: Entry[]): string | undefined {
  return entriesForIssue(issueValue, entries)
    .map((entry) => entry.latest_source_date)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
}

function placeCountForIssue(issueValue: string, entries: Entry[]): number | undefined {
  const places = new Set(
    entriesForIssue(issueValue, entries)
      .map((entry) => entryPlaceLabel(entry))
      .filter((value): value is string => Boolean(value)),
  );

  return places.size > 1 ? places.size : undefined;
}

function issueSummary({
  actorCount,
  featuredActor,
  place,
}: {
  actorCount: number | undefined;
  featuredActor: string | undefined;
  place: string | undefined;
}): string | undefined {
  if (!featuredActor) {
    return undefined;
  }

  const placeLabel = place ? ` in ${place}` : "";
  if (!actorCount || actorCount < 2) {
    return `${featuredActor} is active${placeLabel}.`;
  }

  return `${featuredActor} and ${actorCount - 1} more are active${placeLabel}.`;
}

function issueFacetLabel(value: string, issueAreaLabels: Record<string, string>): string {
  const knownLabel = issueAreaLabels[value];
  if (knownLabel) {
    return knownLabel;
  }

  return humanize(value).replace(/\b(And|Or|Of|The|For|In)\b/g, (word) => word.toLowerCase());
}

function issueFacets(
  facets: FacetOption[] | undefined,
  issueAreaLabels: Record<string, string>,
  entries: Entry[],
): BrowseEditorialFacet[] {
  return sortFacets(facets)
    .slice(0, MAX_SHELF_ITEMS)
    .map((facet) => {
      const issueEntries = entriesForIssue(facet.value, entries);
      const featuredEntry = featuredEntryForIssue(facet.value, entries);
      const detail = issueFacetDetail(facet.value, entries);
      const actorCount = issueEntries.length > 0 ? issueEntries.length : undefined;
      const featuredActor = featuredEntry?.name;

      return {
        actorCount,
        count: facet.count,
        detail,
        evidenceCount: evidenceCountForIssue(facet.value, entries),
        featuredActor,
        filterKey: "issue_areas" as const,
        label: issueFacetLabel(facet.value, issueAreaLabels),
        latestSourceDate: latestSourceDateForIssue(facet.value, entries),
        placeCount: placeCountForIssue(facet.value, entries),
        summary: issueSummary({ actorCount, featuredActor, place: detail }),
        value: facet.value,
      };
    });
}

function placeFacets(response: EntryListResponse | undefined): BrowseEditorialFacet[] {
  const states = sortFacets(response?.facets.states).map((facet) => ({
    count: facet.count,
    filterKey: "states" as const,
    label: STATE_NAME_BY_CODE[facet.value] ?? facet.value,
    value: facet.value,
  }));
  const cities = sortFacets(response?.facets.cities).map((facet) => ({
    count: facet.count,
    filterKey: "cities" as const,
    label: facet.value,
    value: facet.value,
  }));
  const regions = sortFacets(response?.facets.regions).map((facet) => ({
    count: facet.count,
    filterKey: "regions" as const,
    label: facet.value,
    value: facet.value,
  }));

  return [...states, ...cities, ...regions].slice(0, MAX_SHELF_ITEMS);
}

function entryGroups(entries: Entry[]): Record<EntryType, Entry[]> {
  return ENTRY_TYPE_ORDER.reduce<Record<EntryType, Entry[]>>(
    (groups, entryType) => ({
      ...groups,
      [entryType]: sortEntriesForPrimitiveSection(
        entries.filter((entry) => entry.type === entryType),
      ),
    }),
    {
      campaign: [],
      event: [],
      initiative: [],
      organization: [],
      person: [],
    },
  );
}

export function buildBrowseEditorialSections({
  issueAreaLabels,
  response,
}: BuildBrowseEditorialSectionsInput): BrowseEditorialSections {
  const entries = response?.data ?? [];
  const activeIssues = issueFacets(response?.facets.issue_areas, issueAreaLabels, entries);
  const activePlaces = placeFacets(response);

  return {
    activeIssues,
    activePlaces,
    entriesByType: entryGroups(entries),
  };
}
