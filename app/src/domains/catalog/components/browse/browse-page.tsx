import { Link, useNavigate } from "@tanstack/react-router";
import { Grid3X3, List, Map, RotateCcw } from "lucide-react";
import { useMemo } from "react";
import {
  BrowseSearchBox,
  FilterDisclosure,
  GridSurface,
  ListSurface,
} from "@/domains/catalog/components/browse/browse-page-sections";
import { UsMapSurface } from "@/domains/catalog/components/browse/us-map-surface";
import { EntryList } from "@/domains/catalog/components/entries/entry-list";
import { Button } from "@/platform/ui/button";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import {
  ENTITY_TYPE_LABELS,
  FEATURED_ENTRY_TYPES,
  FEATURED_SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
  humanize,
} from "@/domains/catalog/catalog";
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

export interface BrowsePageContent {
  description: string;
  eyebrow: string;
  title: string;
  emptyAction?: {
    label: string;
    to: "/browse" | "/discovery" | "/profiles";
  };
  lockedEntryTypes?: EntryType[];
  resultLabelPlural?: string;
  resultsHeading?: string;
  searchPlaceholder?: string;
  showEntryTypeFilter?: boolean;
  scopeTabs?: {
    isActive?: boolean;
    label: string;
    search?: BrowseRouteSearch;
    to: "/profiles" | "/profiles/people" | "/profiles/organizations";
  }[];
}

interface BrowsePageProps {
  search: BrowseRouteSearch;
  page?: BrowsePageContent;
}

const VIEW_OPTIONS = [
  { value: "map", label: "Map", icon: Map },
  { value: "grid", label: "Grid", icon: Grid3X3 },
  { value: "list", label: "List", icon: List },
] as const;

const DEFAULT_PAGE_CONTENT: BrowsePageContent = {
  eyebrow: "Atlas",
  title: "Browse Atlas",
  description:
    "Search the public civic graph by place, issue area, source type, and actor type. Open any result to inspect the source-backed record behind it.",
  emptyAction: { label: "Discovery", to: "/discovery" },
  resultLabelPlural: "entries",
  resultsHeading: "Entries",
  searchPlaceholder: "Search place, issue, or name",
  showEntryTypeFilter: true,
};

export function BrowsePage({ search, page }: BrowsePageProps) {
  const navigate = useNavigate();
  const { data: taxonomy } = useTaxonomy();
  const rawFilters = useMemo(() => buildBrowseSearch(search), [search]);
  const pageContent = useMemo<BrowsePageContent>(
    () => ({
      ...DEFAULT_PAGE_CONTENT,
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
      <section className="bg-surface-container-lowest rounded-[1.8rem] px-5 py-6 lg:px-7 lg:py-7">
        <p className="type-label-medium text-ink-muted">{pageContent.eyebrow}</p>
        <h1 className="type-display-small text-ink-strong mt-3">{pageContent.title}</h1>
        <p className="type-body-large text-ink-soft mt-3 max-w-3xl">{pageContent.description}</p>
        {pageContent.scopeTabs && pageContent.scopeTabs.length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {pageContent.scopeTabs.map((tab) => (
              <Link
                key={tab.label}
                to={tab.to}
                search={tab.search}
                className={[
                  "type-label-large rounded-full px-4 py-2 transition-colors",
                  tab.isActive
                    ? "bg-ink-strong text-surface"
                    : "bg-surface-container text-ink-strong hover:bg-surface-container-high",
                ].join(" ")}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <header className="bg-page-bg sticky top-0 z-20 space-y-2 px-1 py-2 lg:px-2">
        <div className="flex items-center gap-2">
          <BrowseSearchBox
            key={search.query ?? ""}
            initialQuery={search.query ?? ""}
            onSearch={(query) => {
              runSearch(query);
            }}
            placeholder={pageContent.searchPlaceholder}
          />

          <div className="flex shrink-0 items-center gap-0.5">
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = selectedFilters.view === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    updateSearch({ view: option.value });
                  }}
                  className={[
                    "inline-flex items-center gap-1 rounded-lg p-2 transition-colors",
                    isActive
                      ? "bg-surface-container-high text-ink-strong"
                      : "text-ink-muted hover:text-ink-strong",
                  ].join(" ")}
                  title={option.label}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
            <button
              type="button"
              onClick={resetBrowse}
              className="text-ink-muted hover:text-ink-strong inline-flex items-center rounded-lg p-2 transition-colors"
              title="Reset"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <FilterDisclosure
            label="Issues"
            count={activeCounts.issues}
            items={quickIssueAreas.map((issue) => ({
              key: issue.slug,
              label: issue.label,
              active: selectedFilters.issue_areas.includes(issue.slug),
              onClick: () => {
                handleToggleFilter("issue_areas", issue.slug);
              },
            }))}
          />
          {pageContent.showEntryTypeFilter ? (
            <FilterDisclosure
              label="Types"
              count={activeCounts.types}
              items={FEATURED_ENTRY_TYPES.map((entryType) => ({
                key: entryType,
                label: ENTITY_TYPE_LABELS[entryType],
                active: selectedFilters.entry_types.includes(entryType),
                onClick: () => {
                  handleToggleFilter("entry_types", entryType);
                },
              }))}
            />
          ) : null}
          <FilterDisclosure
            label="Sources"
            count={activeCounts.sources}
            items={FEATURED_SOURCE_TYPES.map((sourceType) => ({
              key: sourceType,
              label: SOURCE_TYPE_LABELS[sourceType],
              active: selectedFilters.source_types.includes(sourceType),
              onClick: () => {
                handleToggleFilter("source_types", sourceType);
              },
            }))}
          />
        </div>
      </header>

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

        <aside className="min-w-0 lg:pt-0">
          <div className="bg-surface-container-high overflow-hidden rounded-[1.45rem] lg:sticky lg:top-20">
            <div className="px-3 pt-3 lg:px-4 lg:pt-4">
              <p className="type-label-small text-ink-muted uppercase">Results</p>
              <h2 className="type-headline-small text-ink-strong mt-2">
                {pageContent.resultsHeading}
              </h2>
            </div>

            <div className="px-3 pb-3 lg:px-4 lg:pb-4">
              {removableBadges.length > 0 ? (
                <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
                  {removableBadges.map((badge) => (
                    <button
                      key={`${badge.key}:${badge.value}`}
                      type="button"
                      onClick={() => {
                        handleToggleFilter(badge.key, badge.value);
                      }}
                      className="type-label-large bg-surface-container-lowest text-ink-soft hover:text-ink-strong rounded-full px-2.5 py-1 transition-colors"
                    >
                      {badge.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <EntryList
              entries={resultEntries}
              total={results?.pagination.total}
              isLoading={entriesQuery.isLoading}
              error={entriesQuery.error}
              issueAreaLabels={issueAreaLabels}
              hasActiveSearch={hasActiveSearch}
              resultLabelPlural={pageContent.resultLabelPlural}
              emptyAction={pageContent.emptyAction}
            />

            {results?.pagination.total ? (
              <div className="bg-surface-container-lowest flex flex-col gap-2 rounded-[1rem] p-2.5 lg:flex-row lg:items-center lg:justify-between">
                <p className="type-body-medium text-ink-muted">
                  Showing {results.pagination.offset + 1}-
                  {Math.min(
                    results.pagination.offset + results.pagination.limit,
                    results.pagination.total,
                  )}{" "}
                  of {results.pagination.total}
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    disabled={results.pagination.offset === 0}
                    onClick={() => {
                      updateSearch({
                        offset: Math.max(0, results.pagination.offset - results.pagination.limit),
                      });
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    disabled={!results.pagination.has_more}
                    onClick={() => {
                      updateSearch({
                        offset: results.pagination.offset + results.pagination.limit,
                      });
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </section>
    </div>
  );
}
