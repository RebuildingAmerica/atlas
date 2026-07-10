import { Link } from "@tanstack/react-router";
import { Map, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import {
  BrowseIntentChips,
  type BrowseIntentChip,
  BrowseSearchBox,
  FilterDisclosure,
} from "@/domains/catalog/components/browse/browse-page-sections";
import {
  ENTITY_TYPE_LABELS,
  FEATURED_ENTRY_TYPES,
  FEATURED_SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
} from "@/domains/catalog/catalog";
import {
  ENTRY_TYPE_ICONS,
  ISSUE_FILTER_ICON,
  SOURCE_FILTER_ICON,
  SOURCE_TYPE_ICONS,
  TYPE_FILTER_ICON,
} from "@/domains/catalog/components/catalog-menu-icons";
import type { BrowseFilterKey, BrowseRouteSearch } from "@/domains/catalog/search-state";

interface BrowseSearchHeaderProps {
  activeCounts: { issues: number; types: number; sources: number };
  initialQuery: string;
  quickIssueAreas: { slug: string; label: string }[];
  intentChips: BrowseIntentChip[];
  mapSearch: BrowseRouteSearch;
  placement?: "editorial" | "results";
  searchPlaceholder?: string;
  selectedEntryTypes: string[];
  selectedIssueAreas: string[];
  selectedSourceTypes: string[];
  showEntryTypeFilter: boolean;
  onResetBrowse: () => void;
  onSearch: (query: string) => void;
  onToggleFilter: (key: BrowseFilterKey, value: string) => void;
}

/**
 * Sticky search/filter header for the browse surface.  Holds the
 * search input, map handoff, reset button, and the issues/types/evidence
 * filter disclosures with their active-count badges.
 */
export function BrowseSearchHeader({
  activeCounts,
  initialQuery,
  intentChips,
  mapSearch,
  placement = "results",
  quickIssueAreas,
  searchPlaceholder,
  selectedEntryTypes,
  selectedIssueAreas,
  selectedSourceTypes,
  showEntryTypeFilter,
  onResetBrowse,
  onSearch,
  onToggleFilter,
}: BrowseSearchHeaderProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = activeCounts.issues + activeCounts.types + activeCounts.sources;
  const frameClass =
    placement === "results"
      ? "bg-page-bg/90 border-border sticky top-0 z-20 border-y px-4 py-2 backdrop-blur md:px-8"
      : "px-4 py-0 md:px-0";
  const innerClass =
    placement === "results"
      ? "mx-auto max-w-[76rem]"
      : "border-border bg-surface-container-low/70 mx-auto max-w-[76rem] border px-2.5 py-2 md:px-3";

  return (
    <section aria-label="Browse tools" className={frameClass}>
      <div className={innerClass}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <BrowseSearchBox
            key={initialQuery}
            initialQuery={initialQuery}
            onSearch={onSearch}
            placeholder={searchPlaceholder}
          />

          <div className="flex shrink-0 items-center gap-px">
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => {
                setFiltersOpen((isOpen) => !isOpen);
              }}
              className="type-label-medium border-border-strong bg-surface-container-lowest text-ink-soft hover:bg-surface-container inline-flex min-h-10 items-center gap-2 border px-3 transition-colors duration-150"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              <span>Filter</span>
              {activeFilterCount > 0 ? (
                <span className="text-ink-muted">{activeFilterCount}</span>
              ) : null}
            </button>
            <Link
              to="/map"
              search={mapSearch}
              className="type-label-medium border-border-strong bg-surface-container-lowest text-ink-soft hover:bg-surface-container inline-flex min-h-10 items-center gap-2 border px-3 no-underline transition-colors duration-150"
            >
              <Map className="h-4 w-4" aria-hidden />
              Map
            </Link>
            <button
              type="button"
              onClick={onResetBrowse}
              className="border-border-strong bg-surface-container-lowest text-ink-soft hover:bg-surface-container inline-flex min-h-10 items-center border px-3 transition-colors duration-150"
              title="Reset"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {filtersOpen ? (
          <div className="mt-2 grid gap-2 lg:grid-cols-3">
            <FilterDisclosure
              label="Issues"
              count={activeCounts.issues}
              icon={ISSUE_FILTER_ICON}
              items={quickIssueAreas.map((issue) => ({
                key: issue.slug,
                label: issue.label,
                active: selectedIssueAreas.includes(issue.slug),
                icon: ISSUE_FILTER_ICON,
                onClick: () => {
                  onToggleFilter("issue_areas", issue.slug);
                },
              }))}
            />
            {showEntryTypeFilter ? (
              <FilterDisclosure
                label="Types"
                count={activeCounts.types}
                icon={TYPE_FILTER_ICON}
                items={FEATURED_ENTRY_TYPES.map((entryType) => ({
                  key: entryType,
                  label: ENTITY_TYPE_LABELS[entryType],
                  active: selectedEntryTypes.includes(entryType),
                  icon: ENTRY_TYPE_ICONS[entryType],
                  onClick: () => {
                    onToggleFilter("entry_types", entryType);
                  },
                }))}
              />
            ) : null}
            <FilterDisclosure
              label="Evidence"
              count={activeCounts.sources}
              icon={SOURCE_FILTER_ICON}
              items={FEATURED_SOURCE_TYPES.map((sourceType) => ({
                key: sourceType,
                label: SOURCE_TYPE_LABELS[sourceType],
                active: selectedSourceTypes.includes(sourceType),
                icon: SOURCE_TYPE_ICONS[sourceType],
                onClick: () => {
                  onToggleFilter("source_types", sourceType);
                },
              }))}
            />
          </div>
        ) : null}

        <BrowseIntentChips chips={intentChips} />
      </div>
    </section>
  );
}
