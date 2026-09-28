import { humanize } from "@rebuildingamerica/atlas-catalog/catalog";
import { STATE_NAME_BY_CODE } from "@rebuildingamerica/atlas-catalog/us-state-grid";
import type { BrowseFilterKey } from "@rebuildingamerica/atlas-catalog/search-state";
import type {
  Entry,
  EntryListResponse,
  EntryType,
  FacetOption,
} from "@rebuildingamerica/atlas-api-client";

export interface BrowseEditorialFacet {
  count: number;
  filterKey: BrowseFilterKey;
  label: string;
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
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_ENTRY_ITEMS);
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
): BrowseEditorialFacet[] {
  return sortFacets(facets)
    .slice(0, MAX_SHELF_ITEMS)
    .map((facet) => ({
      count: facet.count,
      filterKey: "issue_areas" as const,
      label: issueFacetLabel(facet.value, issueAreaLabels),
      value: facet.value,
    }));
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
  const activeIssues = issueFacets(response?.facets.issue_areas, issueAreaLabels);
  const activePlaces = placeFacets(response);

  return {
    activeIssues,
    activePlaces,
    entriesByType: entryGroups(entries),
  };
}
