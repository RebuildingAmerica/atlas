import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useMemo } from "react";
import { BrowseSearchHeader } from "@/domains/catalog/components/browse/browse-search-header";
import {
  buildBrowseEditorialSections,
  type BrowseEditorialFacet,
} from "@/domains/catalog/components/browse/browse-editorial-sections";
import type { BrowseIntentChip } from "@/domains/catalog/components/browse/browse-intent-chips";
import { EntryList } from "@/domains/catalog/components/entries/entry-list";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { ENTITY_TYPE_LABELS, SOURCE_TYPE_LABELS, humanize } from "@/domains/catalog/catalog";
import { trackDiscoveryEvent } from "@/domains/catalog/discovery-events";
import {
  type BrowseFilterKey,
  type BrowseRouteSearch,
  buildBrowseSearch,
  hasActiveBrowseSearch,
  resolveBrowseSearchIntent,
  serializeList,
  toggleValue,
} from "@/domains/catalog/search-state";
import { STATE_NAME_BY_CODE } from "@/domains/catalog/us-state-grid";
import type {
  Entry,
  EntryListResponse,
  EntryType,
  SourcePattern,
  SourceType,
} from "@rebuildingamerica/atlas-api-client";
import { type BrowsePageContent, DEFAULT_BROWSE_PAGE_CONTENT } from "./browse-page-content";
export type { BrowsePageContent } from "./browse-page-content";

interface BrowsePageProps {
  initialEntries?: EntryListResponse;
  initialEntriesLoadFailed?: boolean;
  search: BrowseRouteSearch;
  page?: BrowsePageContent;
}

const INITIAL_ENTRIES_ERROR = new Error("Results could not load.");

const PROFILE_PATH_BY_TYPE: Record<EntryType, string> = {
  campaign: "/profiles/campaigns",
  event: "/profiles/events",
  initiative: "/profiles/initiatives",
  organization: "/profiles/organizations",
  person: "/profiles/people",
};

const PRIMARY_ENTRY_TYPE_SECTION_ORDER: EntryType[] = ["organization", "person"];
const SECONDARY_ENTRY_TYPE_SECTION_ORDER: EntryType[] = ["initiative", "campaign", "event"];
const ENTRY_TYPE_SECTION_ORDER: EntryType[] = [
  ...PRIMARY_ENTRY_TYPE_SECTION_ORDER,
  ...SECONDARY_ENTRY_TYPE_SECTION_ORDER,
];

function resultLabel(count: number): string {
  return count === 1 ? "1 record" : `${count} records`;
}

function sourceLabel(count: number): string {
  return count === 1 ? "1 linked source" : `${count} linked sources`;
}

function actorCountLabel(count: number): string {
  return count === 1 ? "1 person or group" : `${count} people and groups`;
}

function placeCountLabel(count: number): string {
  return count === 1 ? "1 place" : `${count} places`;
}

function facetAriaLabel(item: BrowseEditorialFacet, variant: "issue" | "standard"): string {
  if (variant === "standard") {
    return `${item.label} ${resultLabel(item.count)}`;
  }

  return [
    item.label,
    item.actorCount ? actorCountLabel(item.actorCount) : undefined,
    item.placeCount ? placeCountLabel(item.placeCount) : undefined,
    item.evidenceCount ? sourceLabel(item.evidenceCount) : undefined,
    item.latestSourceDate ? `Latest source ${dateLabel(item.latestSourceDate)}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function dateLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function entryLocation(entry: Entry): string {
  return [entry.city, entry.state, entry.region].filter(Boolean).join(", ");
}

function entryProfileHref(entry: Entry): string {
  return `${PROFILE_PATH_BY_TYPE[entry.type]}/${entry.slug}`;
}

function filterLabel(key: BrowseFilterKey, value: string, issueAreaLabels: Record<string, string>) {
  if (key === "states") {
    return STATE_NAME_BY_CODE[value] ?? value;
  }
  if (key === "issue_areas") {
    return issueAreaLabels[value] ?? humanize(value);
  }
  if (key === "entry_types") {
    return ENTITY_TYPE_LABELS[value as EntryType] ?? humanize(value);
  }
  if (key === "source_types") {
    return SOURCE_TYPE_LABELS[value as SourceType] ?? humanize(value);
  }
  return humanize(value);
}

function browseContextLabel(
  filters: ReturnType<typeof buildBrowseSearch>,
  issueAreaLabels: Record<string, string>,
): string | undefined {
  const labels = [
    ...filters.cities,
    ...filters.states.map((state) => STATE_NAME_BY_CODE[state] ?? state),
    ...filters.regions,
    ...filters.issue_areas.map((issue) => issueAreaLabels[issue] ?? humanize(issue)),
  ];
  const [lead, ...rest] = labels.filter(Boolean);

  if (!lead) {
    return undefined;
  }

  return rest.length > 0 ? `${lead} + ${rest.length} more` : lead;
}

function removeValue(values: string[], value: string): string[] {
  return values.filter((item) => item !== value);
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
      view: "list",
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
            indexContextLabel={indexContextLabel}
            searchTools={browseTools}
            onSelectFacet={handleToggleFilter}
          />
        )}
      </main>
    </div>
  );
}

interface BrowseResultsModeProps {
  discoveryContext: {
    issueAreas: string[];
    places: string[];
    query: string | undefined;
  };
  emptyAction: BrowsePageContent["emptyAction"];
  emptyRecoveryActions: { label: string; onClick: () => void }[];
  entries: Entry[];
  error: Error | null;
  isLoading: boolean;
  issueAreaLabels: Record<string, string>;
  indexContextLabel: string | undefined;
  pagination: EntryListResponse["pagination"] | undefined;
  relatedSections: ReturnType<typeof buildBrowseEditorialSections>;
  resultLabelPlural: string | undefined;
  onPageChange: (offset: number) => void;
  onSelectFacet: (key: BrowseFilterKey, value: string) => void;
}

function BrowseResultsMode({
  discoveryContext,
  emptyAction,
  emptyRecoveryActions,
  entries,
  error,
  isLoading,
  issueAreaLabels,
  indexContextLabel,
  pagination,
  relatedSections,
  resultLabelPlural,
  onPageChange,
  onSelectFacet,
}: BrowseResultsModeProps) {
  const previousOffset =
    pagination && pagination.offset > 0 ? Math.max(0, pagination.offset - pagination.limit) : null;
  const nextOffset = pagination?.has_more ? pagination.offset + pagination.limit : null;

  return (
    <>
      <section aria-label="Search results" className="max-w-4xl">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="type-headline-small text-ink-strong">People and groups</h2>
          {pagination ? (
            <p className="type-body-medium text-ink-muted">{resultLabel(pagination.total)}</p>
          ) : null}
        </div>

        <EntryList
          entries={entries}
          total={pagination?.total}
          isLoading={isLoading}
          error={error}
          issueAreaLabels={issueAreaLabels}
          hasActiveSearch
          resultLabelPlural={resultLabelPlural}
          discoveryContext={discoveryContext}
          emptyAction={emptyAction}
          emptyRecoveryActions={emptyRecoveryActions}
        />

        {pagination ? (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={previousOffset === null}
              onClick={() => {
                if (previousOffset !== null) {
                  onPageChange(previousOffset);
                }
              }}
              className="type-label-large border-border text-ink-soft disabled:text-ink-muted rounded-full border px-4 py-2 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={nextOffset === null}
              onClick={() => {
                if (nextOffset !== null) {
                  onPageChange(nextOffset);
                }
              }}
              className="type-label-large border-border text-ink-soft disabled:text-ink-muted rounded-full border px-4 py-2 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        ) : null}
      </section>

      <PrimitiveFacetSection
        title={indexContextLabel ? `Issues in ${indexContextLabel}` : "Issues"}
        items={relatedSections.activeIssues.slice(0, 4)}
        variant="issue"
        onSelectFacet={onSelectFacet}
      />
      <PrimitiveFacetSection
        title={indexContextLabel ? `Places in ${indexContextLabel}` : "Places"}
        items={relatedSections.activePlaces.slice(0, 4)}
        onSelectFacet={onSelectFacet}
      />
    </>
  );
}

interface BrowseEditorialModeProps {
  indexContextLabel: string | undefined;
  searchTools: ReactNode;
  sections: ReturnType<typeof buildBrowseEditorialSections>;
  onSelectFacet: (key: BrowseFilterKey, value: string) => void;
}

function BrowseEditorialMode({
  indexContextLabel,
  searchTools,
  sections,
  onSelectFacet,
}: BrowseEditorialModeProps) {
  const hasAnySection =
    sections.activeIssues.length > 0 ||
    sections.activePlaces.length > 0 ||
    ENTRY_TYPE_SECTION_ORDER.some((entryType) => sections.entriesByType[entryType].length > 0);

  if (!hasAnySection) {
    return (
      <section className="border-border bg-surface-container-lowest max-w-2xl border px-8 py-10">
        <h2 className="type-title-large text-ink-strong">No people or groups listed.</h2>
      </section>
    );
  }

  return (
    <>
      <PrimitiveFacetSection
        title={indexContextLabel ? `Issues in ${indexContextLabel}` : "Issues"}
        items={sections.activeIssues}
        variant="issue"
        onSelectFacet={onSelectFacet}
      />
      {searchTools}
      {PRIMARY_ENTRY_TYPE_SECTION_ORDER.map((entryType) => (
        <PrimitiveEntrySection
          key={entryType}
          entries={sections.entriesByType[entryType]}
          title={ENTITY_TYPE_LABELS[entryType]}
        />
      ))}
      <PrimitiveFacetSection
        title={indexContextLabel ? `Places in ${indexContextLabel}` : "Places"}
        items={sections.activePlaces}
        onSelectFacet={onSelectFacet}
      />
      {SECONDARY_ENTRY_TYPE_SECTION_ORDER.map((entryType) => (
        <PrimitiveEntrySection
          key={entryType}
          entries={sections.entriesByType[entryType]}
          title={ENTITY_TYPE_LABELS[entryType]}
        />
      ))}
    </>
  );
}

function PrimitiveFacetSection({
  items,
  title,
  variant = "standard",
  onSelectFacet,
}: {
  items: BrowseEditorialFacet[];
  title: string;
  variant?: "issue" | "standard";
  onSelectFacet: (key: BrowseFilterKey, value: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section aria-label={title} className="space-y-4">
      <SectionHeading title={title} />
      <div
        className={
          variant === "issue"
            ? "grid gap-3 md:grid-cols-2"
            : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        }
      >
        {items.slice(0, 8).map((item, index) => (
          <button
            key={`${item.filterKey}:${item.value}`}
            type="button"
            aria-label={facetAriaLabel(item, variant)}
            onClick={() => {
              onSelectFacet(item.filterKey, item.value);
            }}
            className={[
              variant === "issue"
                ? "border-border-strong bg-surface-container-high hover:bg-surface-container-highest min-h-40 border px-5 py-5 text-left transition-colors duration-150 md:min-h-36"
                : "border-border-strong bg-surface-container hover:bg-surface-container-high min-h-28 border px-5 py-4 text-left transition-colors duration-150",
              variant === "issue" && index === 0 ? "border-l-accent border-l-4" : "",
            ].join(" ")}
          >
            <span
              className={
                variant === "issue"
                  ? "text-ink-strong block font-serif text-xl leading-snug"
                  : "text-ink-strong block font-serif text-lg leading-snug"
              }
            >
              {item.label}
            </span>
            {item.summary ? (
              <span className="type-body-medium text-ink-soft mt-3 block">{item.summary}</span>
            ) : null}
            <span className="mt-4 flex flex-wrap gap-2">
              {item.actorCount ? (
                <span className="type-label-small border-border-strong bg-surface-container-lowest text-ink-soft border px-2.5 py-1">
                  {actorCountLabel(item.actorCount)}
                </span>
              ) : null}
              {item.placeCount ? (
                <span className="type-label-small border-border-strong bg-surface-container-lowest text-ink-soft border px-2.5 py-1">
                  {placeCountLabel(item.placeCount)}
                </span>
              ) : null}
              {item.evidenceCount ? (
                <span className="type-label-small border-border-strong bg-surface-container-lowest text-ink-soft border px-2.5 py-1">
                  {sourceLabel(item.evidenceCount)}
                </span>
              ) : null}
              {item.latestSourceDate ? (
                <span className="type-label-small border-border-strong bg-surface-container-lowest text-ink-muted border px-2.5 py-1">
                  Latest source {dateLabel(item.latestSourceDate)}
                </span>
              ) : null}
              {variant === "standard" ? (
                <span className="type-label-small border-border-strong bg-surface-container-lowest text-ink-muted border px-2.5 py-1">
                  {resultLabel(item.count)}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PrimitiveEntrySection({ entries, title }: { entries: Entry[]; title: string }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section aria-label={title} className="space-y-4">
      <SectionHeading title={title} />
      <div className={entries.length === 1 ? "grid gap-3" : "grid gap-3 lg:grid-cols-2"}>
        {entries.map((entry) => (
          <EntryBriefCard key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function EntryBriefCard({ entry }: { entry: Entry }) {
  const location = entryLocation(entry);
  const latest = dateLabel(entry.latest_source_date ?? entry.updated_at);

  return (
    <article className="border-border bg-surface-container-low hover:bg-surface-container border px-5 py-4 transition-colors duration-150">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <a
            href={entryProfileHref(entry)}
            className="text-ink-strong font-serif text-lg hover:underline"
          >
            {entry.name}
          </a>
          {location ? <p className="type-body-small text-ink-muted mt-1">{location}</p> : null}
        </div>
        <span className="type-label-small border-border-strong text-ink-soft w-fit border px-2.5 py-1 md:justify-self-end">
          {sourceLabel(entry.source_count)}
        </span>
      </div>
      <p className="type-body-medium text-ink-soft mt-3 line-clamp-2">{entry.description}</p>
      {latest ? <p className="type-body-small text-ink-muted mt-3">Updated {latest}</p> : null}
    </article>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="border-border flex items-end justify-between border-b pb-3">
      <h2 className="text-ink-strong font-serif text-2xl">{title}</h2>
    </div>
  );
}
