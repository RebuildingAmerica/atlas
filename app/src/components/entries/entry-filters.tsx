import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { EntrySearchFacets, FacetOption } from "@/types";

type FilterKey = "states" | "cities" | "regions" | "issue_areas" | "entry_types" | "source_types";

interface EntryFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onClear: () => void;
  selectedFilters: Record<FilterKey, string[]>;
  onToggleFilter: (key: FilterKey, value: string) => void;
  facets: EntrySearchFacets;
  issueAreaLabels: Record<string, string>;
}

function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function FacetGroup({
  title,
  facetKey,
  options,
  selected,
  onToggle,
  labelMap = {},
}: {
  title: string;
  facetKey: FilterKey;
  options: FacetOption[];
  selected: string[];
  onToggle: (key: FilterKey, value: string) => void;
  labelMap?: Record<string, string>;
}) {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{title}</p>
      <div className="flex flex-wrap gap-2">
        {options.slice(0, 10).map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(facetKey, option.value)}
              className={[
                "rounded-full border px-3 py-1.5 text-sm transition-colors",
                isSelected
                  ? "border-blue-600 bg-blue-50 text-blue-800"
                  : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50",
              ].join(" ")}
            >
              {labelMap[option.value] ?? humanize(option.value)}{" "}
              <span className="text-stone-400">{option.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function EntryFilters({
  query,
  onQueryChange,
  onSearchSubmit,
  onClear,
  selectedFilters,
  onToggleFilter,
  facets,
  issueAreaLabels,
}: EntryFiltersProps) {
  return (
    <Card className="rounded-3xl border-stone-200 bg-white shadow-sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
        className="space-y-6"
      >
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            Search the map
          </p>
          <Input
            value={query}
            onChange={onQueryChange}
            placeholder="Search people, organizations, initiatives, or places"
          />
          <div className="flex gap-3">
            <Button type="submit" className="flex-1">
              Apply search
            </Button>
            <Button type="button" variant="ghost" onClick={onClear}>
              Clear
            </Button>
          </div>
        </div>

        <FacetGroup
          title="States"
          facetKey="states"
          options={facets.states}
          selected={selectedFilters.states}
          onToggle={onToggleFilter}
        />
        <FacetGroup
          title="Municipalities"
          facetKey="cities"
          options={facets.cities}
          selected={selectedFilters.cities}
          onToggle={onToggleFilter}
        />
        <FacetGroup
          title="Regions"
          facetKey="regions"
          options={facets.regions}
          selected={selectedFilters.regions}
          onToggle={onToggleFilter}
        />
        <FacetGroup
          title="Issue areas"
          facetKey="issue_areas"
          options={facets.issue_areas}
          selected={selectedFilters.issue_areas}
          onToggle={onToggleFilter}
          labelMap={issueAreaLabels}
        />
        <FacetGroup
          title="Entity types"
          facetKey="entry_types"
          options={facets.entity_types}
          selected={selectedFilters.entry_types}
          onToggle={onToggleFilter}
        />
        <FacetGroup
          title="Mention types"
          facetKey="source_types"
          options={facets.source_types}
          selected={selectedFilters.source_types}
          onToggle={onToggleFilter}
        />
      </form>
    </Card>
  );
}
