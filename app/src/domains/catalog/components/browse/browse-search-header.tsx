import { Link } from "@tanstack/react-router";
import { Map, RotateCcw } from "lucide-react";
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
 * search input, map handoff, reset button, and the issues/types/sources
 * filter disclosures with their active-count badges.
 */
export function BrowseSearchHeader({
  activeCounts,
  initialQuery,
  intentChips,
  mapSearch,
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
  return (
    <header className="bg-page-bg sticky top-0 z-20 space-y-2 px-1 py-2 lg:px-2">
      <div className="flex items-center gap-2">
        <BrowseSearchBox
          key={initialQuery}
          initialQuery={initialQuery}
          onSearch={onSearch}
          placeholder={searchPlaceholder}
        />

        <div className="flex shrink-0 items-center gap-0.5">
          <Link
            to="/map"
            search={mapSearch}
            className="type-label-large text-ink-muted hover:text-ink-strong inline-flex items-center gap-1 rounded-lg px-2 py-2 transition-colors"
          >
            <Map className="h-4 w-4" />
            Map
          </Link>
          <button
            type="button"
            onClick={onResetBrowse}
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
          label="Sources"
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

      <BrowseIntentChips chips={intentChips} />
    </header>
  );
}
