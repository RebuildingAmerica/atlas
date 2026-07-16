import {
  ENTITY_TYPE_LABELS,
  humanize,
  SOURCE_TYPE_LABELS,
} from "@rebuildingamerica/atlas-catalog/catalog";
import { STATE_NAME_BY_CODE } from "@rebuildingamerica/atlas-catalog/us-state-grid";
import type {
  BrowseRouteSearch,
  BrowseFilterKey,
} from "@rebuildingamerica/atlas-catalog/search-state";
import { serializeList } from "@rebuildingamerica/atlas-catalog/search-state";
import type { EntryType, SourceType } from "@rebuildingamerica/atlas-api-client";
import type {
  BrowseCollectionFunnel,
  BrowseIssueStarter,
} from "@/domains/catalog/components/browse/browse-exploration-guides";
import type { BrowseIntentChip } from "@/domains/catalog/components/browse/browse-intent-chips";
import type { BrowseSurfaceState } from "@/domains/catalog/components/browse/browse-surfaces";

export interface BrowseIntentBadge {
  key: BrowseFilterKey;
  label: string;
  value: string;
}

export function buildCollectionFunnels({
  dominantStates,
  explorationIssueAreas,
  issueAreaLabels,
  selectedFilters,
  selectedState,
  updateSearch,
}: {
  dominantStates: BrowseSurfaceState[];
  explorationIssueAreas: BrowseIssueStarter[];
  issueAreaLabels: Record<string, string>;
  selectedFilters: {
    issue_areas: string[];
    entry_types: string[];
  };
  selectedState?: string;
  updateSearch: (next: Partial<BrowseRouteSearch>) => void;
}): BrowseCollectionFunnel[] {
  const fallbackState = selectedState ?? dominantStates[0]?.state;
  const fallbackStateName = fallbackState
    ? (STATE_NAME_BY_CODE[fallbackState] ?? fallbackState)
    : undefined;
  const fallbackIssue = selectedFilters.issue_areas[0] ?? explorationIssueAreas[0]?.slug;
  const fallbackIssueLabel = fallbackIssue
    ? (issueAreaLabels[fallbackIssue] ?? humanize(fallbackIssue))
    : undefined;
  const funnels: BrowseCollectionFunnel[] = [];

  if (fallbackState && fallbackStateName && fallbackIssue && fallbackIssueLabel) {
    funnels.push({
      id: `${fallbackState}:${fallbackIssue}:landscape`,
      label: `${fallbackStateName} ${fallbackIssueLabel}`,
      meta: "People and organizations",
      onSelect: () => {
        updateSearch({
          issue_areas: fallbackIssue,
          offset: 0,
          states: fallbackState,
          view: "list",
        });
      },
    });
  }

  if (fallbackIssue && fallbackIssueLabel) {
    funnels.push({
      id: `${fallbackIssue}:people`,
      label: `People working on ${fallbackIssueLabel}`,
      meta: "Actor-first path",
      onSelect: () => {
        updateSearch({
          entry_types: "person",
          issue_areas: fallbackIssue,
          offset: 0,
          view: "list",
        });
      },
    });
  }

  if (fallbackState && fallbackStateName) {
    funnels.push({
      id: `${fallbackState}:organizations`,
      label: `${fallbackStateName} organizations`,
      meta: "Local organizations",
      onSelect: () => {
        updateSearch({
          entry_types: "organization",
          offset: 0,
          states: fallbackState,
          view: "list",
        });
      },
    });
  }

  return funnels;
}

export function buildSelectedBadges(
  selectedFilters: {
    entry_types: string[];
    issue_areas: string[];
    source_patterns: string[];
    source_types: string[];
    states: string[];
  },
  issueAreaLabels: Record<string, string>,
): BrowseIntentBadge[] {
  return [
    ...selectedFilters.states.map((value) => ({
      key: "states" as const,
      value,
      label: STATE_NAME_BY_CODE[value] ?? value,
    })),
    ...selectedFilters.issue_areas.map((value) => ({
      key: "issue_areas" as const,
      value,
      label: issueAreaLabels[value] ?? humanize(value),
    })),
    ...selectedFilters.entry_types.map((value) => ({
      key: "entry_types" as const,
      value,
      label: ENTITY_TYPE_LABELS[value as EntryType] ?? humanize(value),
    })),
    ...selectedFilters.source_types.map((value) => ({
      key: "source_types" as const,
      value,
      label: SOURCE_TYPE_LABELS[value as SourceType] ?? humanize(value),
    })),
    ...selectedFilters.source_patterns.map((value) => ({
      key: "source_patterns" as const,
      value,
      label: humanize(value),
    })),
  ];
}

export function buildDiscoveryContext(selectedFilters: {
  cities: string[];
  issue_areas: string[];
  query?: string;
  regions: string[];
  source_types: string[];
  states: string[];
}): {
  issueAreas: string[];
  places: string[];
  query?: string;
  sourceTypes: string[];
} {
  return {
    issueAreas: selectedFilters.issue_areas,
    places: [
      ...selectedFilters.cities,
      ...selectedFilters.regions,
      ...selectedFilters.states.map((value) => STATE_NAME_BY_CODE[value] ?? value),
    ],
    query: selectedFilters.query,
    sourceTypes: selectedFilters.source_types,
  };
}

export function buildCurrentContext({
  issueAreaLabels,
  selectedFilters,
  selectedStateName,
}: {
  issueAreaLabels: Record<string, string>;
  selectedFilters: {
    entry_types: string[];
    issue_areas: string[];
    source_patterns: string[];
    source_types: string[];
  };
  selectedStateName?: string;
}): string {
  return [
    selectedStateName ?? "United States",
    selectedFilters.issue_areas[0] ? issueAreaLabels[selectedFilters.issue_areas[0]] : null,
    selectedFilters.entry_types[0]
      ? ENTITY_TYPE_LABELS[selectedFilters.entry_types[0] as EntryType]
      : null,
    selectedFilters.source_types[0]
      ? SOURCE_TYPE_LABELS[selectedFilters.source_types[0] as SourceType]
      : null,
    selectedFilters.source_patterns[0] ? humanize(selectedFilters.source_patterns[0]) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function buildActiveCounts({
  pageContent,
  searchForActivity,
  selectedFilters,
}: {
  pageContent: { showEntryTypeFilter?: boolean };
  searchForActivity: { entry_types: string[] };
  selectedFilters: {
    issue_areas: string[];
    source_patterns: string[];
    source_types: string[];
  };
}): { issues: number; types: number; sources: number } {
  return {
    issues: selectedFilters.issue_areas.length,
    types: pageContent.showEntryTypeFilter ? searchForActivity.entry_types.length : 0,
    sources: selectedFilters.source_types.length + selectedFilters.source_patterns.length,
  };
}

export function buildMapSearch(selectedFilters: {
  cities: string[];
  entry_types: string[];
  issue_areas: string[];
  offset: number;
  query?: string;
  regions: string[];
  source_patterns: string[];
  source_types: string[];
  states: string[];
}): BrowseRouteSearch {
  return {
    cities: serializeList(selectedFilters.cities),
    entry_types: serializeList(selectedFilters.entry_types),
    issue_areas: serializeList(selectedFilters.issue_areas),
    offset: selectedFilters.offset,
    query: selectedFilters.query,
    regions: serializeList(selectedFilters.regions),
    source_patterns: serializeList(selectedFilters.source_patterns),
    source_types: serializeList(selectedFilters.source_types),
    states: serializeList(selectedFilters.states),
    view: "map",
  };
}

export function buildIntentChips({
  removableBadges,
  selectedQuery,
  updateSearch,
  handleToggleFilter,
}: {
  handleToggleFilter: (key: BrowseFilterKey, value: string) => void;
  removableBadges: BrowseIntentBadge[];
  selectedQuery?: string;
  updateSearch: (next: Partial<BrowseRouteSearch>) => void;
}): BrowseIntentChip[] {
  const chips: BrowseIntentChip[] = [];

  if (selectedQuery) {
    chips.push({
      id: "query",
      label: `Search: ${selectedQuery}`,
      onRemove: () => {
        updateSearch({ offset: 0, query: undefined });
      },
    });
  }

  removableBadges.forEach((badge) => {
    chips.push({
      id: `${badge.key}:${badge.value}`,
      label: badge.label,
      onRemove: () => {
        handleToggleFilter(badge.key, badge.value);
      },
    });
  });

  return chips;
}

export function buildEmptyRecoveryActions({
  removableBadges,
  resetBrowse,
  selectedState,
  selectedStateName,
  handleToggleFilter,
  updateSearch,
}: {
  handleToggleFilter: (key: BrowseFilterKey, value: string) => void;
  removableBadges: BrowseIntentBadge[];
  resetBrowse: () => void;
  selectedState?: string;
  selectedStateName?: string;
  updateSearch: (next: Partial<BrowseRouteSearch>) => void;
}): { label: string; onClick: () => void }[] {
  const actions = removableBadges.slice(0, 3).map((badge) => ({
    label: `Remove ${badge.label}`,
    onClick: () => {
      handleToggleFilter(badge.key, badge.value);
    },
  }));

  if (selectedState && selectedStateName) {
    actions.push({
      label: `Browse ${selectedStateName}`,
      onClick: () => {
        updateSearch({
          cities: undefined,
          entry_types: undefined,
          issue_areas: undefined,
          offset: 0,
          query: undefined,
          regions: undefined,
          source_patterns: undefined,
          source_types: undefined,
          states: selectedState,
          view: "list",
        });
      },
    });
  }

  actions.push({
    label: "Clear all filters",
    onClick: resetBrowse,
  });

  return actions;
}

export { buildIssueBrief, buildPlaceBrief } from "./browse-page-derivations-briefs";
export { sourcePatternBriefLabel } from "./browse-page-derivations-helpers";
