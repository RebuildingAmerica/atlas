/** The two browse layouts: search results, and the editorial landing. */

import { type ReactNode } from "react";
import type { buildBrowseEditorialSections } from "@/domains/catalog/components/browse/browse-editorial-sections";
import { type BrowseEditorialFacet } from "@/domains/catalog/components/browse/browse-editorial-sections";
import { EntryList } from "@/domains/catalog/components/entries/entry-list";
import type { Entry, EntryListResponse } from "@rebuildingamerica/atlas-api-client";
import { ENTITY_TYPE_LABELS } from "@rebuildingamerica/atlas-catalog/catalog";
import type { BrowseFilterKey } from "@rebuildingamerica/atlas-catalog/search-state";
import type { BrowsePageContent } from "./browse-page-content";
import {
  ENTRY_TYPE_SECTION_ORDER,
  PRIMARY_ENTRY_TYPE_SECTION_ORDER,
  SECONDARY_ENTRY_TYPE_SECTION_ORDER,
  actorCountLabel,
  dateLabel,
  entryLocation,
  entryProfileHref,
  facetAriaLabel,
  placeCountLabel,
  resultLabel,
  sourceLabel,
} from "./browse-page-labels";
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

export function BrowseResultsMode({
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
              onClick={
                previousOffset === null
                  ? undefined
                  : () => {
                      onPageChange(previousOffset);
                    }
              }
              className="type-label-large border-border text-ink-soft disabled:text-ink-muted rounded-full border px-4 py-2 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={nextOffset === null}
              onClick={
                nextOffset === null
                  ? undefined
                  : () => {
                      onPageChange(nextOffset);
                    }
              }
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
  searchTools: ReactNode;
  sections: ReturnType<typeof buildBrowseEditorialSections>;
  onSelectFacet: (key: BrowseFilterKey, value: string) => void;
}

/**
 * The unfiltered browse surface. Editorial mode only shows while no place or
 * issue is selected, so its shelves are never scoped to one — the scoped
 * headings live in the results mode below.
 */
export function BrowseEditorialMode({
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
        title="Issues"
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
        title="Places"
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
      <p className="type-body-small text-ink-muted mt-3">Updated {latest}</p>
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
