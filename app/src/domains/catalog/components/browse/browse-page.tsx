import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { BrowseSearchHeader } from "@/domains/catalog/components/browse/browse-search-header";
import { buildBrowseEditorialSections } from "@/domains/catalog/components/browse/browse-editorial-sections";
import type { BrowseIntentChip } from "@/domains/catalog/components/browse/browse-intent-chips";
import { useEntries } from "@rebuildingamerica/atlas-catalog/hooks/use-entries";
import { useTaxonomy } from "@rebuildingamerica/atlas-catalog/hooks/use-taxonomy";
import { ENTITY_TYPE_LABELS, SOURCE_TYPE_LABELS } from "@rebuildingamerica/atlas-catalog/catalog";
import { trackDiscoveryEvent } from "@/domains/catalog/discovery-events";
import {
  type BrowseFilterKey,
  type BrowseRouteSearch,
  buildBrowseSearch,
  hasActiveBrowseSearch,
  resolveBrowseSearchIntent,
  serializeList,
  toggleValue,
} from "@rebuildingamerica/atlas-catalog/search-state";
import { STATE_NAME_BY_CODE } from "@rebuildingamerica/atlas-catalog/us-state-grid";
import type {
  EntryListResponse,
  EntryType,
  SourcePattern,
  SourceType,
} from "@rebuildingamerica/atlas-api-client";
import { type BrowsePageContent, DEFAULT_BROWSE_PAGE_CONTENT } from "./browse-page-content";
import {
  INITIAL_ENTRIES_ERROR,
  browseContextLabel,
  filterLabel,
  removeValue,
} from "./browse-page-labels";
import { BrowseEditorialMode, BrowseResultsMode } from "./browse-page-modes";
export type { BrowsePageContent } from "./browse-page-content";

interface BrowsePageProps {
  initialEntries?: EntryListResponse;
  initialEntriesLoadFailed?: boolean;
  search: BrowseRouteSearch;
  page?: BrowsePageContent;
}

export function BrowsePage({
  initialEntries,
  initialEntriesLoadFailed = false,
  search,
  page,
}: BrowsePageProps) {
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
      entry_types: pageContent.lockedEntryTypes?.length
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
    initialEntries
      ? { initialData: initialEntries }
      : initialEntriesLoadFailed
        ? { enabled: false, retry: false }
        : { retry: false },
  );

  const results = entriesQuery.data;
  const entries = results?.data ?? [];
  const resultsError = initialEntriesLoadFailed ? INITIAL_ENTRIES_ERROR : entriesQuery.error;
  const searchForActivity = useMemo(
    () => ({
      ...selectedFilters,
      entry_types: pageContent.lockedEntryTypes?.length ? [] : selectedFilters.entry_types,
    }),
    [pageContent.lockedEntryTypes, selectedFilters],
  );
  const hasActiveSearch = hasActiveBrowseSearch(searchForActivity);
  const editorialSections = useMemo(
    () => buildBrowseEditorialSections({ issueAreaLabels, response: results }),
    [issueAreaLabels, results],
  );

  const quickIssueAreas = useMemo(() => {
    const taxonomyIssues = taxonomy ? Object.values(taxonomy).flat() : [];
    if (taxonomyIssues.length > 0) {
      return taxonomyIssues.slice(0, 10).map((issue) => ({ slug: issue.slug, label: issue.name }));
    }

    return editorialSections.activeIssues
      .slice(0, 10)
      .map((issue) => ({ slug: issue.value, label: issue.label }));
  }, [editorialSections.activeIssues, taxonomy]);

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
        view: "list",
      });
    },
    [selectedFilters, updateSearch],
  );

  const runSearch = (value: string) => {
    const intent = resolveBrowseSearchIntent(value, {
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
      view: "list",
    };

    trackDiscoveryEvent("catalog_search_submitted", {
      city_count: intent.cities.length,
      entry_type_count: intent.entry_types.length,
      issue_count: intent.issue_areas.length,
      query: intent.query ?? value,
      region_count: intent.regions.length,
      source_type_count: intent.source_types.length,
      state_count: intent.states.length,
    });
    updateSearch(nextSearch);
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

  const intentChips = useMemo<BrowseIntentChip[]>(() => {
    const chips: BrowseIntentChip[] = [];
    if (selectedFilters.query) {
      chips.push({
        id: "query",
        label: selectedFilters.query,
        onRemove: () => {
          updateSearch({ offset: 0, query: undefined });
        },
      });
    }

    const filterKeys: BrowseFilterKey[] = [
      "states",
      "cities",
      "regions",
      "issue_areas",
      "entry_types",
      "source_types",
      "source_patterns",
    ];
    filterKeys.forEach((key) => {
      selectedFilters[key].forEach((value) => {
        chips.push({
          id: `${key}:${value}`,
          label: filterLabel(key, value, issueAreaLabels),
          onRemove: () => {
            updateSearch({
              [key]: serializeList(removeValue(selectedFilters[key], value)),
              offset: 0,
            });
          },
        });
      });
    });

    return chips;
  }, [issueAreaLabels, selectedFilters, updateSearch]);

  const discoveryContext = useMemo(
    () => ({
      issueAreas: selectedFilters.issue_areas,
      places: [
        ...selectedFilters.cities,
        ...selectedFilters.states.map((state) => STATE_NAME_BY_CODE[state] ?? state),
        ...selectedFilters.regions,
      ],
      query: selectedFilters.query,
    }),
    [selectedFilters],
  );
  const indexContextLabel = useMemo(
    () => browseContextLabel(selectedFilters, issueAreaLabels),
    [issueAreaLabels, selectedFilters],
  );

  const emptyRecoveryActions = useMemo(
    () =>
      intentChips.map((chip) => ({
        label: `Remove ${chip.label}`,
        onClick: chip.onRemove,
      })),
    [intentChips],
  );

  const activeCounts = {
    issues: selectedFilters.issue_areas.length,
    sources: selectedFilters.source_types.length,
    types: selectedFilters.entry_types.length,
  };
  const shouldShowResults = hasActiveSearch || Boolean(resultsError) || entriesQuery.isLoading;

  const mapSearch: BrowseRouteSearch = {
    ...search,
    cities: serializeList(selectedFilters.cities),
    entry_types: serializeList(selectedFilters.entry_types),
    issue_areas: serializeList(selectedFilters.issue_areas),
    query: selectedFilters.query,
    regions: serializeList(selectedFilters.regions),
    source_patterns: serializeList(selectedFilters.source_patterns),
    source_types: serializeList(selectedFilters.source_types),
    states: serializeList(selectedFilters.states),
  };

  const browseTitle = page ? pageContent.title : "Browse Atlas";
  const browseTools = (
    <BrowseSearchHeader
      activeCounts={activeCounts}
      initialQuery={search.query ?? ""}
      intentChips={intentChips}
      mapSearch={mapSearch}
      placement={shouldShowResults ? "results" : "editorial"}
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
  );

  return (
    <div className="text-ink-strong">
      <section className="px-4 pt-4 pb-2 md:px-8">
        <div className="mx-auto w-full max-w-[76rem]">
          <h1 className="text-3xl leading-tight text-balance md:text-4xl">{browseTitle}</h1>
        </div>
      </section>

      {shouldShowResults ? browseTools : null}

      <main className="mx-auto w-full max-w-[76rem] space-y-12 px-4 py-4 md:px-8 md:py-6">
        {shouldShowResults ? (
          <BrowseResultsMode
            entries={entries}
            emptyAction={pageContent.emptyAction}
            emptyRecoveryActions={emptyRecoveryActions}
            error={resultsError}
            issueAreaLabels={issueAreaLabels}
            isLoading={entriesQuery.isLoading}
            pagination={results?.pagination}
            relatedSections={editorialSections}
            indexContextLabel={indexContextLabel}
            resultLabelPlural={pageContent.resultLabelPlural}
            discoveryContext={discoveryContext}
            onPageChange={(offset) => {
              updateSearch({ offset });
            }}
            onSelectFacet={handleToggleFilter}
          />
        ) : (
          <BrowseEditorialMode
            sections={editorialSections}
            searchTools={browseTools}
            onSelectFacet={handleToggleFilter}
          />
        )}
      </main>
    </div>
  );
}
