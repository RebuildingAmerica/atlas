import { useEffect, useMemo } from "react";
import { trackDiscoveryEvent } from "@/domains/catalog/discovery-events";
import type {
  BrowseFilterKey,
  BrowseRouteSearch,
} from "@rebuildingamerica/atlas-catalog/search-state";
import type { EntryListResponse, EntryType } from "@rebuildingamerica/atlas-api-client";
import type { BrowsePageContent } from "@/domains/catalog/components/browse/browse-page-content";
import type {
  BrowseIssueBrief,
  BrowsePlaceBrief,
} from "@/domains/catalog/components/browse/browse-results-aside";
import type {
  BrowseCollectionFunnel,
  BrowseIssueStarter,
} from "@/domains/catalog/components/browse/browse-exploration-guides";
import type { BrowseIntentChip } from "@/domains/catalog/components/browse/browse-intent-chips";
import type { BrowseSurfaceState } from "@/domains/catalog/components/browse/browse-surfaces";
import {
  buildActiveCounts,
  buildCollectionFunnels,
  buildCurrentContext,
  buildDiscoveryContext,
  buildEmptyRecoveryActions,
  buildIntentChips,
  buildIssueBrief,
  buildMapSearch,
  buildPlaceBrief,
  buildSelectedBadges,
  type BrowseIntentBadge,
} from "./browse-page-derivations";

export interface BrowsePageDetailsInput {
  dominantStates: BrowseSurfaceState[];
  explorationIssueAreas: BrowseIssueStarter[];
  issueAreaLabels: Record<string, string>;
  pageContent: BrowsePageContent;
  isLoading: boolean;
  results?: EntryListResponse;
  searchForActivity: {
    entry_types: string[];
    issue_areas: string[];
    query?: string;
    source_types: string[];
  };
  hasActiveSearch: boolean;
  selectedFilters: {
    cities: string[];
    entry_types: string[];
    issue_areas: string[];
    offset: number;
    query?: string;
    regions: string[];
    source_patterns: string[];
    source_types: string[];
    states: string[];
  };
  selectedState?: string;
  selectedStateName?: string;
  updateSearch: (next: Partial<BrowseRouteSearch>) => void;
  handleToggleFilter: (key: BrowseFilterKey, value: string) => void;
  resetBrowse: () => void;
}

export interface BrowsePageDetails {
  activeCounts: { issues: number; types: number; sources: number };
  collectionFunnels: BrowseCollectionFunnel[];
  currentContext: string;
  discoveryContext: {
    issueAreas: string[];
    places: string[];
    query?: string;
    sourceTypes: string[];
  };
  emptyRecoveryActions: { label: string; onClick: () => void }[];
  intentChips: BrowseIntentChip[];
  issueBrief: BrowseIssueBrief | undefined;
  mapSearch: BrowseRouteSearch;
  matchCountLabel: string;
  placeBrief: BrowsePlaceBrief | undefined;
  removableBadges: BrowseIntentBadge[];
  selectedIssueLabel: string | undefined;
}

/**
 * Calculate the browse page's derived labels, chips, and contextual briefings.
 */
export function useBrowsePageDetails({
  dominantStates,
  explorationIssueAreas,
  handleToggleFilter,
  issueAreaLabels,
  pageContent,
  isLoading,
  resetBrowse,
  results,
  hasActiveSearch,
  searchForActivity,
  selectedFilters,
  selectedState,
  selectedStateName,
  updateSearch,
}: BrowsePageDetailsInput): BrowsePageDetails {
  const selectedBadges = useMemo(
    () => buildSelectedBadges(selectedFilters, issueAreaLabels),
    [issueAreaLabels, selectedFilters],
  );
  const removableBadges = useMemo(
    () =>
      selectedBadges.filter((badge) => {
        return !(
          badge.key === "entry_types" &&
          pageContent.lockedEntryTypes?.includes(badge.value as EntryType)
        );
      }),
    [pageContent.lockedEntryTypes, selectedBadges],
  );
  const discoveryContext = useMemo(() => buildDiscoveryContext(selectedFilters), [selectedFilters]);
  const collectionFunnels = useMemo(
    () =>
      buildCollectionFunnels({
        dominantStates,
        explorationIssueAreas,
        issueAreaLabels,
        selectedFilters: {
          entry_types: selectedFilters.entry_types,
          issue_areas: selectedFilters.issue_areas,
        },
        selectedState,
        updateSearch,
      }),
    [
      dominantStates,
      explorationIssueAreas,
      issueAreaLabels,
      selectedFilters.entry_types,
      selectedFilters.issue_areas,
      selectedState,
      updateSearch,
    ],
  );
  const currentContext = useMemo(
    () =>
      buildCurrentContext({
        issueAreaLabels,
        selectedFilters: {
          entry_types: selectedFilters.entry_types,
          issue_areas: selectedFilters.issue_areas,
          source_patterns: selectedFilters.source_patterns,
          source_types: selectedFilters.source_types,
        },
        selectedStateName,
      }),
    [
      issueAreaLabels,
      selectedFilters.entry_types,
      selectedFilters.issue_areas,
      selectedFilters.source_patterns,
      selectedFilters.source_types,
      selectedStateName,
    ],
  );
  const activeCounts = useMemo(
    () =>
      buildActiveCounts({
        pageContent,
        searchForActivity,
        selectedFilters: {
          issue_areas: selectedFilters.issue_areas,
          source_patterns: selectedFilters.source_patterns,
          source_types: selectedFilters.source_types,
        },
      }),
    [
      pageContent,
      searchForActivity,
      selectedFilters.issue_areas,
      selectedFilters.source_patterns,
      selectedFilters.source_types,
    ],
  );
  const mapSearch = useMemo(() => buildMapSearch(selectedFilters), [selectedFilters]);
  const intentChips = useMemo(
    () =>
      buildIntentChips({
        handleToggleFilter,
        removableBadges,
        selectedQuery: selectedFilters.query,
        updateSearch,
      }),
    [handleToggleFilter, removableBadges, selectedFilters.query, updateSearch],
  );
  const emptyRecoveryActions = useMemo(
    () =>
      buildEmptyRecoveryActions({
        handleToggleFilter,
        removableBadges,
        resetBrowse,
        selectedState,
        selectedStateName,
        updateSearch,
      }),
    [
      handleToggleFilter,
      removableBadges,
      resetBrowse,
      selectedState,
      selectedStateName,
      updateSearch,
    ],
  );
  const placeBrief = useMemo(
    () =>
      buildPlaceBrief({
        entries: results,
        issueAreaLabels,
        selectedFilters: {
          issue_areas: selectedFilters.issue_areas,
        },
        selectedStateName,
      }),
    [issueAreaLabels, results, selectedFilters.issue_areas, selectedStateName],
  );
  const selectedIssueLabel = selectedFilters.issue_areas[0]
    ? (issueAreaLabels[selectedFilters.issue_areas[0]] ?? selectedFilters.issue_areas[0])
    : undefined;
  const issueBrief = useMemo(
    () =>
      buildIssueBrief({
        entries: results,
        issueAreaLabels,
        selectedFilters: {
          issue_areas: selectedFilters.issue_areas,
        },
      }),
    [issueAreaLabels, results, selectedFilters.issue_areas],
  );
  const matchCountLabel = useMemo(
    () =>
      results?.pagination.total === 1 ? "1 match" : `${results?.pagination.total ?? 0} matches`,
    [results?.pagination.total],
  );

  useEffect(() => {
    const resultTotal = results?.pagination?.total;

    if (isLoading || resultTotal === undefined) {
      return;
    }

    trackDiscoveryEvent("catalog_results_rendered", {
      result_count: resultTotal,
    });
  }, [isLoading, results]);

  useEffect(() => {
    if (isLoading || !results || !hasActiveSearch || results.pagination.total !== 0) {
      return;
    }

    trackDiscoveryEvent("catalog_zero_results", {
      query: selectedFilters.query,
      result_count: 0,
    });
  }, [hasActiveSearch, isLoading, results, selectedFilters.query]);

  return {
    activeCounts,
    collectionFunnels,
    currentContext,
    discoveryContext,
    emptyRecoveryActions,
    intentChips,
    issueBrief,
    mapSearch,
    matchCountLabel,
    placeBrief,
    removableBadges,
    selectedIssueLabel,
  };
}
