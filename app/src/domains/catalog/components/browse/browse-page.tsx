import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { BrowseEcosystemHistorySection } from "@/domains/catalog/components/browse/browse-ecosystem-history-section";
import {
  BrowseExplorationGuides,
  type BrowseCollectionFunnel,
  type BrowseIntentChip,
  GridSurface,
  ListSurface,
} from "@/domains/catalog/components/browse/browse-page-sections";
import { UsMapSurface } from "@/domains/catalog/components/browse/us-map-surface";
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
import {
  BrowseResultsAside,
  type BrowseIssueBrief,
  type BrowsePlaceBrief,
  type BrowseResearchContext,
} from "./browse-results-aside";
import { BrowseSearchHeader } from "./browse-search-header";

export type { BrowsePageContent } from "./browse-page-content";

const SOURCE_PATTERN_BRIEF_LABELS: Record<SourcePattern, string> = {
  multi_source: "Multi-source confirmation",
  single_source: "Single-source leads",
  social_only: "Social-only signals",
};

interface BrowseIntentBadge {
  key: BrowseFilterKey;
  label: string;
  value: string;
}

interface BrowsePageProps {
  initialEntries?: EntryListResponse;
  search: BrowseRouteSearch;
  page?: BrowsePageContent;
}

function sourcePatternBriefLabel(value: string): string {
  return SOURCE_PATTERN_BRIEF_LABELS[value as SourcePattern] ?? humanize(value);
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

  const selectedBadges: BrowseIntentBadge[] = [
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
  const removableBadges = selectedBadges.filter((badge) => {
    return !(
      badge.key === "entry_types" &&
      pageContent.lockedEntryTypes?.includes(badge.value as EntryType)
    );
  });
  const discoveryContext = useMemo(
    () => ({
      issueAreas: selectedFilters.issue_areas,
      places: [
        ...selectedFilters.cities,
        ...selectedFilters.regions,
        ...selectedFilters.states.map((value) => STATE_NAME_BY_CODE[value] ?? value),
      ],
      query: selectedFilters.query,
      sourceTypes: selectedFilters.source_types,
    }),
    [selectedFilters],
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

  const collectionFunnels = useMemo<BrowseCollectionFunnel[]>(() => {
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
  }, [
    dominantStates,
    explorationIssueAreas,
    issueAreaLabels,
    selectedFilters.issue_areas,
    selectedState,
    updateSearch,
  ]);

  const currentContext = [
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

  const activeCounts = {
    issues: selectedFilters.issue_areas.length,
    types: pageContent.showEntryTypeFilter ? searchForActivity.entry_types.length : 0,
    sources: selectedFilters.source_types.length + selectedFilters.source_patterns.length,
  };
  const intentChips = useMemo<BrowseIntentChip[]>(() => {
    const chips: BrowseIntentChip[] = [];

    if (selectedFilters.query) {
      chips.push({
        id: "query",
        label: `Search: ${selectedFilters.query}`,
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
  }, [handleToggleFilter, removableBadges, selectedFilters.query, updateSearch]);
  const emptyRecoveryActions = useMemo(() => {
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
  }, [
    handleToggleFilter,
    removableBadges,
    resetBrowse,
    selectedState,
    selectedStateName,
    updateSearch,
  ]);

  useEffect(() => {
    if (!entriesQuery.isLoading && hasActiveSearch && results?.pagination.total === 0) {
      trackDiscoveryEvent("catalog_zero_results", {
        query: selectedFilters.query,
        result_count: 0,
      });
    }
  }, [entriesQuery.isLoading, hasActiveSearch, results?.pagination.total, selectedFilters.query]);

  useEffect(() => {
    if (!entriesQuery.isLoading && results?.pagination.total !== undefined) {
      trackDiscoveryEvent("catalog_results_rendered", {
        result_count: results.pagination.total,
      });
    }
  }, [entriesQuery.isLoading, results?.pagination.total]);

  const researchContext = useMemo<BrowseResearchContext | undefined>(() => {
    if (!hasActiveSearch) {
      return undefined;
    }

    const chips = [
      ...selectedFilters.states.map((value) => STATE_NAME_BY_CODE[value] ?? value),
      ...selectedFilters.cities,
      ...selectedFilters.regions,
      ...selectedFilters.issue_areas.map((value) => issueAreaLabels[value] ?? humanize(value)),
      ...selectedFilters.entry_types.map(
        (value) => ENTITY_TYPE_LABELS[value as EntryType] ?? humanize(value),
      ),
      ...selectedFilters.source_types.map(
        (value) => SOURCE_TYPE_LABELS[value as SourceType] ?? humanize(value),
      ),
      ...selectedFilters.source_patterns.map((value) => humanize(value)),
    ];

    return {
      chips,
      query: selectedFilters.query,
    };
  }, [hasActiveSearch, issueAreaLabels, selectedFilters]);
  const placeBrief = useMemo<BrowsePlaceBrief | undefined>(() => {
    const selectedIssueArea = selectedFilters.issue_areas[0];
    if (!selectedStateName || !selectedIssueArea || !results?.pagination) {
      return undefined;
    }

    const issueLabel = issueAreaLabels[selectedIssueArea] ?? humanize(selectedIssueArea);
    const ecosystemLabel = issueLabel.split(/\s+/)[0]?.toLowerCase() ?? "local";
    const strongestSourcePattern = [...(results.facets.source_patterns ?? [])].sort(
      (left, right) => right.count - left.count,
    )[0];

    return {
      body: `${results.pagination.total} source-linked records for ${issueLabel}.`,
      signal: strongestSourcePattern
        ? `Strongest signal: ${sourcePatternBriefLabel(strongestSourcePattern.value)}`
        : undefined,
      title: `${selectedStateName} ${ecosystemLabel} ecosystem`,
    };
  }, [
    issueAreaLabels,
    results?.facets.source_patterns,
    results?.pagination,
    selectedFilters.issue_areas,
    selectedStateName,
  ]);
  const selectedIssueLabel = selectedFilters.issue_areas[0]
    ? (issueAreaLabels[selectedFilters.issue_areas[0]] ?? humanize(selectedFilters.issue_areas[0]))
    : undefined;
  const issueBrief = useMemo<BrowseIssueBrief | undefined>(() => {
    const selectedIssueArea = selectedFilters.issue_areas[0];
    if (!selectedIssueArea || !results?.pagination) {
      return undefined;
    }

    const issueLabel = issueAreaLabels[selectedIssueArea] ?? humanize(selectedIssueArea);
    const strongestSourcePattern = [...(results.facets.source_patterns ?? [])].sort(
      (left, right) => right.count - left.count,
    )[0];
    const multiSourceCount =
      results.facets.source_patterns?.find((facet) => facet.value === "multi_source")?.count ?? 0;
    const gap =
      results.pagination.total > 0 && multiSourceCount < results.pagination.total / 2
        ? "Gap: build more multi-source confirmation."
        : undefined;

    return {
      body: `${results.pagination.total} source-linked actors across current results.`,
      gap,
      signal: strongestSourcePattern
        ? `Source signal: ${sourcePatternBriefLabel(strongestSourcePattern.value)}`
        : undefined,
      title: `${issueLabel} landscape`,
    };
  }, [
    issueAreaLabels,
    results?.facets.source_patterns,
    results?.pagination,
    selectedFilters.issue_areas,
  ]);

  return (
    <div className="mx-auto w-full max-w-[88rem] space-y-3 px-3 py-2 md:px-4 lg:space-y-4 lg:py-3">
      <BrowseHero
        description={pageContent.description}
        eyebrow={pageContent.eyebrow}
        scopeTabs={pageContent.scopeTabs}
        title={pageContent.title}
      />

      <BrowseSearchHeader
        activeCounts={activeCounts}
        initialQuery={search.query ?? ""}
        intentChips={intentChips}
        quickIssueAreas={quickIssueAreas}
        searchPlaceholder={pageContent.searchPlaceholder}
        selectedEntryTypes={selectedFilters.entry_types}
        selectedIssueAreas={selectedFilters.issue_areas}
        selectedSourceTypes={selectedFilters.source_types}
        showEntryTypeFilter={Boolean(pageContent.showEntryTypeFilter)}
        view={selectedFilters.view}
        onResetBrowse={resetBrowse}
        onSearch={runSearch}
        onSelectView={(value) => {
          updateSearch({ view: value });
        }}
        onToggleFilter={handleToggleFilter}
      />

      <BrowseExplorationGuides
        collectionFunnels={collectionFunnels}
        entryTypes={pageContent.showEntryTypeFilter ? FEATURED_ENTRY_TYPES : []}
        issues={explorationIssueAreas}
        states={dominantStates}
        onSelectEntryType={handleSelectEntryType}
        onSelectIssue={handleSelectIssue}
        onSelectState={handleSelectState}
      />

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)] xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)] 2xl:grid-cols-[minmax(0,1.55fr)_minmax(24rem,0.85fr)]">
        <div className="min-w-0 space-y-3">
          <div className="bg-surface-container min-w-0 overflow-hidden rounded-[1.45rem]">
            <div className="flex items-center justify-between px-3 py-2 lg:px-4">
              <p className="type-title-medium text-ink-strong">{currentContext}</p>
              <span className="type-body-small text-ink-muted">
                {total} {pageContent.resultLabelPlural}
              </span>
            </div>

            {selectedFilters.view === "map" ? (
              <UsMapSurface
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
            issueLabel={selectedIssueLabel}
            placeLabel={selectedStateName}
            total={total}
          />
        </div>

        <BrowseResultsAside
          emptyAction={pageContent.emptyAction}
          entries={rankedEntries}
          error={entriesQuery.error}
          hasActiveSearch={hasActiveSearch}
          isLoading={entriesQuery.isLoading}
          discoveryContext={discoveryContext}
          emptyRecoveryActions={emptyRecoveryActions}
          issueAreaLabels={issueAreaLabels}
          issueBrief={issueBrief}
          pagination={results?.pagination}
          placeBrief={placeBrief}
          removableBadges={removableBadges}
          researchContext={researchContext}
          resultLabelPlural={pageContent.resultLabelPlural}
          resultsHeading={pageContent.resultsHeading}
          onPageChange={(offset) => {
            updateSearch({ offset });
          }}
          onToggleFilter={handleToggleFilter}
        />
      </section>
    </div>
  );
}
