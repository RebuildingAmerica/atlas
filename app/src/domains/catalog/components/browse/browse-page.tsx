import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { GridSurface, ListSurface } from "@/domains/catalog/components/browse/browse-page-sections";
import { UsMapSurface } from "@/domains/catalog/components/browse/us-map-surface";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { ENTITY_TYPE_LABELS, SOURCE_TYPE_LABELS, humanize } from "@/domains/catalog/catalog";
import {
  type BrowseFilterKey,
  type BrowseRouteSearch,
  buildBrowseSearch,
  hasActiveBrowseSearch,
  serializeList,
  toggleValue,
} from "@/domains/catalog/search-state";
import { buildStateDensity } from "@/domains/catalog/surface-model";
import { STATE_NAME_BY_CODE } from "@/domains/catalog/us-state-grid";
import type { EntryType, SourceType } from "@/types";
import { BrowseHero } from "./browse-hero";
import { type BrowsePageContent, DEFAULT_BROWSE_PAGE_CONTENT } from "./browse-page-content";
import { BrowseResultsAside } from "./browse-results-aside";
import { BrowseSearchHeader } from "./browse-search-header";

export type { BrowsePageContent } from "./browse-page-content";

interface BrowsePageProps {
  search: BrowseRouteSearch;
  page?: BrowsePageContent;
}

export function BrowsePage({ search, page }: BrowsePageProps) {
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

  const entriesQuery = useEntries({
    query: selectedFilters.query,
    states: selectedFilters.states,
    cities: selectedFilters.cities,
    regions: selectedFilters.regions,
    issue_areas: selectedFilters.issue_areas,
    entry_types: selectedFilters.entry_types as EntryType[],
    source_types: selectedFilters.source_types as SourceType[],
    limit: 20,
    offset: selectedFilters.offset,
  });

  const results = entriesQuery.data;
  const resultEntries = results?.data ?? [];
  const total = results?.pagination.total ?? 0;
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
    updateSearch({ query: value || undefined, offset: 0 });
  };

  const handleSelectState = (stateCode: string) => {
    updateSearch({
      states: serializeList(selectedState === stateCode ? [] : [stateCode]),
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
  ]
    .filter(Boolean)
    .join(" · ");

  const activeCounts = {
    issues: selectedFilters.issue_areas.length,
    types: pageContent.showEntryTypeFilter ? searchForActivity.entry_types.length : 0,
    sources: selectedFilters.source_types.length,
  };

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

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)] xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)] 2xl:grid-cols-[minmax(0,1.55fr)_minmax(24rem,0.85fr)]">
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

        <BrowseResultsAside
          emptyAction={pageContent.emptyAction}
          entries={resultEntries}
          error={entriesQuery.error}
          hasActiveSearch={hasActiveSearch}
          isLoading={entriesQuery.isLoading}
          issueAreaLabels={issueAreaLabels}
          pagination={results?.pagination}
          removableBadges={removableBadges}
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
