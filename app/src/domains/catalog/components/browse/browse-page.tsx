import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { BrowseEcosystemHistorySection } from "@/domains/catalog/components/browse/browse-ecosystem-history-section";
import {
  BrowseExplorationGuides,
  GridSurface,
  ListSurface,
} from "@/domains/catalog/components/browse/browse-page-sections";
import { BrowseMapSurface } from "@/domains/catalog/components/browse/browse-map-surface";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import {
  ENTITY_TYPE_LABELS,
  FEATURED_ENTRY_TYPES,
  FEATURED_ISSUE_STARTERS,
  SOURCE_TYPE_LABELS,
  humanize,
} from "@/domains/catalog/catalog";
import { trackDiscoveryEvent } from "@/domains/catalog/discovery-events";
import { rankEntriesForDiscovery } from "@/domains/catalog/discovery-ranking";
import {
  type BrowseFilterKey,
  type BrowseRouteSearch,
  buildBrowseSearch,
  hasActiveBrowseSearch,
  resolveBrowseSearchIntent,
  serializeList,
  toggleValue,
} from "@/domains/catalog/search-state";
import { buildStateDensity } from "@/domains/catalog/surface-model";
import { STATE_NAME_BY_CODE } from "@/domains/catalog/us-state-grid";
import type { EntryListResponse, EntryType, SourcePattern, SourceType } from "@/types";
import { BrowseHero } from "./browse-hero";
import { type BrowsePageContent, DEFAULT_BROWSE_PAGE_CONTENT } from "./browse-page-content";
import { BrowseResultsAside } from "./browse-results-aside";
import { BrowseSearchHeader } from "./browse-search-header";
import { useBrowsePageDetails } from "@/domains/catalog/hooks/use-browse-page-details";

export type { BrowsePageContent } from "./browse-page-content";

interface BrowsePageProps {
  initialEntries?: EntryListResponse;
  search: BrowseRouteSearch;
  page?: BrowsePageContent;
}

export function BrowsePage({ initialEntries, search, page }: BrowsePageProps) {
  const navigate = useNavigate();
  const { data: taxonomy } = useTaxonomy();
  const rawFilters = useMemo(() => buildBrowseSearch(search), [search]);
  const pageContent = useMemo<BrowsePageContent>(
    () => ({
      ...DEFAULT_BROWSE_PAGE_CONTENT,
      ...page,
      lockedEntryTypes: page?.lockedEntryTypes ?? [],
    }),
    [page],
  );

  const selectedFilters = useMemo(
    () => ({
      ...rawFilters,
      entry_types:
        pageContent.lockedEntryTypes && pageContent.lockedEntryTypes.length > 0
          ? pageContent.lockedEntryTypes
          : rawFilters.entry_types,
    }),
    [pageContent.lockedEntryTypes, rawFilters],
  );

  const issueAreaLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    if (!taxonomy) {
      return labels;
    }

    Object.values(taxonomy).forEach((issues) => {
      issues.forEach((issue) => {
        labels[issue.slug] = issue.name;
      });
    });

    return labels;
  }, [taxonomy]);

  const quickIssueAreas = useMemo(() => {
    if (!taxonomy) {
      return [];
    }

    return Object.values(taxonomy)
      .flat()
      .slice(0, 10)
      .map((issue) => ({ slug: issue.slug, label: issue.name }));
  }, [taxonomy]);

  const entryFilters = {
    query: selectedFilters.query,
    states: selectedFilters.states,
    cities: selectedFilters.cities,
    regions: selectedFilters.regions,
    issue_areas: selectedFilters.issue_areas,
    entry_types: selectedFilters.entry_types as EntryType[],
    source_types: selectedFilters.source_types as SourceType[],
    source_patterns: selectedFilters.source_patterns as SourcePattern[],
    limit: 20,
    offset: selectedFilters.offset,
  };
  const entriesQuery = useEntries(
    entryFilters,
    initialEntries ? { initialData: initialEntries } : undefined,
  );

  const results = entriesQuery.data;
  const resultEntries = useMemo(() => results?.data ?? [], [results?.data]);
  const total = results?.pagination.total ?? 0;
  const facetIssueAreas = useMemo(
    () =>
      [...(results?.facets.issue_areas ?? [])]
        .sort((left, right) => right.count - left.count)
        .slice(0, 10)
        .map((issue) => ({
          slug: issue.value,
          label: issueAreaLabels[issue.value] ?? humanize(issue.value),
        })),
    [issueAreaLabels, results?.facets.issue_areas],
  );
  const explorationIssueAreas = useMemo(() => {
    if (quickIssueAreas.length > 0) {
      return quickIssueAreas;
    }
    if (facetIssueAreas.length > 0) {
      return facetIssueAreas;
    }
    return FEATURED_ISSUE_STARTERS.map((issue) => ({ ...issue }));
  }, [facetIssueAreas, quickIssueAreas]);
  const searchForActivity = useMemo(
    () => ({
      ...selectedFilters,
      entry_types:
        pageContent.lockedEntryTypes && pageContent.lockedEntryTypes.length > 0
          ? []
          : selectedFilters.entry_types,
    }),
    [pageContent.lockedEntryTypes, selectedFilters],
  );
  const hasActiveSearch = hasActiveBrowseSearch(searchForActivity);
  const stateDensity = useMemo(
    () => buildStateDensity(results?.facets.states ?? []),
    [results?.facets.states],
  );

  const selectedState = selectedFilters.states[0];
  const selectedStateName = selectedState
    ? (STATE_NAME_BY_CODE[selectedState] ?? selectedState)
    : undefined;
  const dominantStates = useMemo(
    () => [...stateDensity].sort((left, right) => right.count - left.count).slice(0, 12),
    [stateDensity],
  );

  const rankedEntries = useMemo(
    () =>
      rankEntriesForDiscovery(resultEntries, {
        cities: selectedFilters.cities,
        issue_areas: selectedFilters.issue_areas,
        query: selectedFilters.query,
        regions: selectedFilters.regions,
        source_types: selectedFilters.source_types,
        states: selectedFilters.states,
      }),
    [resultEntries, selectedFilters],
  );
  const cityNames = useMemo(
    () => (results?.facets.cities ?? []).map((facet) => facet.value),
    [results?.facets.cities],
  );
  const regionNames = useMemo(
    () => (results?.facets.regions ?? []).map((facet) => facet.value),
    [results?.facets.regions],
  );

  const updateSearch = useCallback(
    (next: Partial<BrowseRouteSearch>) => {
      void navigate({
        to: ".",
        resetScroll: false,
        search: (previous) => ({
          ...previous,
          ...next,
        }),
      });
    },
    [navigate],
  );

  const handleToggleFilter = useCallback(
    (key: BrowseFilterKey, value: string) => {
      if (selectedFilters[key].includes(value)) {
        trackDiscoveryEvent("catalog_filter_removed", {
          filter_key: key,
          value,
        });
      }

      updateSearch({
        [key]: serializeList(toggleValue(selectedFilters[key], value)),
        offset: 0,
      });
    },
    [selectedFilters, updateSearch],
  );

  const runSearch = (value?: string) => {
    const intent = resolveBrowseSearchIntent(value ?? "", {
      cityNames,
      entryTypeLabels: ENTITY_TYPE_LABELS,
      issueAreaLabels,
      regionNames,
      sourceTypeLabels: SOURCE_TYPE_LABELS,
      stateNameByCode: STATE_NAME_BY_CODE,
    });
    const nextSearch: Partial<BrowseRouteSearch> = {
      cities: serializeList(intent.cities),
      entry_types: serializeList(intent.entry_types),
      issue_areas: serializeList(intent.issue_areas),
      query: intent.query,
      regions: serializeList(intent.regions),
      source_types: serializeList(intent.source_types),
      states: serializeList(intent.states),
      offset: 0,
    };

    trackDiscoveryEvent("catalog_search_submitted", {
      city_count: intent.cities.length,
      entry_type_count: intent.entry_types.length,
      issue_count: intent.issue_areas.length,
      query: intent.query ?? value ?? "",
      region_count: intent.regions.length,
      source_type_count: intent.source_types.length,
      state_count: intent.states.length,
    });
    updateSearch(nextSearch);
  };

  const handleSelectState = (stateCode: string) => {
    updateSearch({
      states: serializeList(selectedState === stateCode ? [] : [stateCode]),
      offset: 0,
    });
  };

  const handleSelectIssue = (issueSlug: string) => {
    updateSearch({
      issue_areas: serializeList([issueSlug]),
      offset: 0,
    });
  };

  const handleSelectEntryType = (entryType: EntryType) => {
    updateSearch({
      entry_types: serializeList([entryType]),
      offset: 0,
    });
  };

  const resetBrowse = useCallback(() => {
    void navigate({
      to: ".",
      resetScroll: false,
      search: {
        view: "list",
      },
    });
  }, [navigate]);

  const pageDetails = useBrowsePageDetails({
    dominantStates,
    explorationIssueAreas,
    hasActiveSearch,
    isLoading: entriesQuery.isLoading,
    handleToggleFilter,
    issueAreaLabels,
    pageContent,
    resetBrowse,
    results,
    searchForActivity,
    selectedFilters,
    selectedState,
    selectedStateName,
    updateSearch,
  });
  return (
    <div className="mx-auto w-full max-w-[88rem] space-y-3 px-3 py-2 md:px-4 lg:space-y-4 lg:py-3">
      <BrowseHero
        description={pageContent.description}
        eyebrow={pageContent.eyebrow}
        scopeTabs={pageContent.scopeTabs}
        title={pageContent.title}
      />

      <BrowseSearchHeader
        activeCounts={pageDetails.activeCounts}
        initialQuery={search.query ?? ""}
        intentChips={pageDetails.intentChips}
        mapSearch={pageDetails.mapSearch}
        quickIssueAreas={quickIssueAreas}
        searchPlaceholder={pageContent.searchPlaceholder}
        selectedEntryTypes={selectedFilters.entry_types}
        selectedIssueAreas={selectedFilters.issue_areas}
        selectedSourceTypes={selectedFilters.source_types}
        showEntryTypeFilter={Boolean(pageContent.showEntryTypeFilter)}
        onResetBrowse={resetBrowse}
        onSearch={runSearch}
        onToggleFilter={handleToggleFilter}
      />

      {!hasActiveSearch ? (
        <BrowseExplorationGuides
          collectionFunnels={pageDetails.collectionFunnels}
          entryTypes={pageContent.showEntryTypeFilter ? FEATURED_ENTRY_TYPES : []}
          issues={explorationIssueAreas}
          states={dominantStates}
          onSelectEntryType={handleSelectEntryType}
          onSelectIssue={handleSelectIssue}
          onSelectState={handleSelectState}
        />
      ) : null}

      <section className="grid gap-3 lg:grid-cols-[minmax(22rem,0.9fr)_minmax(0,1.15fr)] xl:grid-cols-[minmax(24rem,0.85fr)_minmax(0,1.35fr)]">
        <BrowseResultsAside
          emptyAction={pageContent.emptyAction}
          entries={rankedEntries}
          error={entriesQuery.error}
          hasActiveSearch={hasActiveSearch}
          isLoading={entriesQuery.isLoading}
          discoveryContext={pageDetails.discoveryContext}
          emptyRecoveryActions={pageDetails.emptyRecoveryActions}
          issueAreaLabels={issueAreaLabels}
          issueBrief={pageDetails.issueBrief}
          pagination={results?.pagination}
          placeBrief={pageDetails.placeBrief}
          resultLabelPlural={pageContent.resultLabelPlural}
          resultsHeading={pageContent.resultsHeading}
          onPageChange={(offset) => {
            updateSearch({ offset });
          }}
        />

        <div className="min-w-0 space-y-3">
          <div className="bg-surface-container min-w-0 overflow-hidden rounded-[1.45rem]">
            <div className="flex items-center justify-between px-3 py-2 lg:px-4">
              <p className="type-title-medium text-ink-strong">{pageDetails.currentContext}</p>
              <span className="type-body-small text-ink-muted">{pageDetails.matchCountLabel}</span>
            </div>

            {selectedFilters.view === "map" ? (
              <BrowseMapSurface
                stateDensity={stateDensity}
                selectedState={selectedState}
                onSelectState={handleSelectState}
              />
            ) : selectedFilters.view === "grid" ? (
              <GridSurface
                states={dominantStates}
                selectedState={selectedState}
                onSelectState={handleSelectState}
              />
            ) : (
              <ListSurface
                states={dominantStates}
                selectedState={selectedState}
                onSelectState={handleSelectState}
              />
            )}
          </div>

          <BrowseEcosystemHistorySection
            entries={rankedEntries}
            issueLabel={pageDetails.selectedIssueLabel}
            placeLabel={selectedStateName}
            total={total}
          />
        </div>
      </section>
    </div>
  );
}
