import { Grid3X3, List, Map, RotateCcw } from "lucide-react";
import {
  BrowseSearchBox,
  FilterDisclosure,
} from "@/domains/catalog/components/browse/browse-page-sections";
import {
  ENTITY_TYPE_LABELS,
  FEATURED_ENTRY_TYPES,
  FEATURED_SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
} from "@/domains/catalog/catalog";
import type { BrowseFilterKey } from "@/domains/catalog/search-state";

const VIEW_OPTIONS = [
  { value: "map", label: "Map", icon: Map },
  { value: "grid", label: "Grid", icon: Grid3X3 },
  { value: "list", label: "List", icon: List },
] as const;

interface BrowseSearchHeaderProps {
  activeCounts: { issues: number; types: number; sources: number };
  initialQuery: string;
  quickIssueAreas: { slug: string; label: string }[];
  searchPlaceholder?: string;
  selectedEntryTypes: string[];
  selectedIssueAreas: string[];
  selectedSourceTypes: string[];
  showEntryTypeFilter: boolean;
  view: string | undefined;
  onResetBrowse: () => void;
  onSearch: (query: string) => void;
  onSelectView: (value: "map" | "grid" | "list") => void;
  onToggleFilter: (key: BrowseFilterKey, value: string) => void;
}

/**
 * Sticky search/filter header for the browse surface.  Holds the
 * search input, the view-mode toggles (map/grid/list), the reset
 * button, and the issues/types/sources filter disclosures with their
 * active-count badges.
 */
export function BrowseSearchHeader({
  activeCounts,
  initialQuery,
  quickIssueAreas,
  searchPlaceholder,
  selectedEntryTypes,
  selectedIssueAreas,
  selectedSourceTypes,
  showEntryTypeFilter,
  view,
  onResetBrowse,
  onSearch,
  onSelectView,
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
          {VIEW_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isActive = view === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onSelectView(option.value);
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
          items={quickIssueAreas.map((issue) => ({
            key: issue.slug,
            label: issue.label,
            active: selectedIssueAreas.includes(issue.slug),
            onClick: () => {
              onToggleFilter("issue_areas", issue.slug);
            },
          }))}
        />
        {showEntryTypeFilter ? (
          <FilterDisclosure
            label="Types"
            count={activeCounts.types}
            items={FEATURED_ENTRY_TYPES.map((entryType) => ({
              key: entryType,
              label: ENTITY_TYPE_LABELS[entryType],
              active: selectedEntryTypes.includes(entryType),
              onClick: () => {
                onToggleFilter("entry_types", entryType);
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
            active: selectedSourceTypes.includes(sourceType),
            onClick: () => {
              onToggleFilter("source_types", sourceType);
            },
          }))}
        />
      </div>
    </header>
  );
}
