import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { BrowseEcosystemHistorySection } from "@/domains/catalog/components/browse/browse-ecosystem-history-section";
import {
  BrowseExplorationGuides,
  GridSurface,
  ListSurface,
} from "@/domains/catalog/components/browse/browse-page-sections";
import { UsMapSurface } from "@/domains/catalog/components/browse/us-map-surface";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import {
  ENTITY_TYPE_LABELS,
  FEATURED_ISSUE_STARTERS,
  SOURCE_TYPE_LABELS,
  humanize,
} from "@/domains/catalog/catalog";
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
  const resultEntries = results?.data ?? [];
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
  const explorationIssueAreas =
    quickIssueAreas.length > 0
      ? quickIssueAreas
      : facetIssueAreas.length > 0
        ? facetIssueAreas
        : [...FEATURED_ISSUE_STARTERS];
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

  const selectedBadges = [
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
    if (badge.key === "states") {
      return false;
    }

    return !(
      badge.key === "entry_types" &&
      pageContent.lockedEntryTypes?.includes(badge.value as EntryType)
    );
  });

  const updateSearch = (next: Partial<BrowseRouteSearch>) => {
    void navigate({
      to: ".",
      resetScroll: false,
      search: (previous) => ({
        ...previous,
        ...next,
      }),
    });
  };

  const handleToggleFilter = (key: BrowseFilterKey, value: string) => {
    updateSearch({
      [key]: serializeList(toggleValue(selectedFilters[key], value)),
      offset: 0,
    });
  };

  const runSearch = (value?: string) => {
    const intent = resolveBrowseSearchIntent(value ?? "", {
      issueAreaLabels,
      stateNameByCode: STATE_NAME_BY_CODE,
    });
    const nextSearch: Partial<BrowseRouteSearch> = {
      query: intent.query,
      offset: 0,
    };

    if (intent.states.length > 0) {
      nextSearch.states = serializeList(intent.states);
    }
    if (intent.issue_areas.length > 0) {
      nextSearch.issue_areas = serializeList(intent.issue_areas);
    }

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

  const resetBrowse = () => {
    void navigate({
      to: ".",
      resetScroll: false,
      search: {
        view: "map",
      },
    });
  };

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
        issues={explorationIssueAreas}
        states={dominantStates}
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
            entries={resultEntries}
            issueLabel={selectedIssueLabel}
            placeLabel={selectedStateName}
            total={total}
          />
        </div>

        <BrowseResultsAside
          emptyAction={pageContent.emptyAction}
          entries={resultEntries}
          error={entriesQuery.error}
          hasActiveSearch={hasActiveSearch}
          isLoading={entriesQuery.isLoading}
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
