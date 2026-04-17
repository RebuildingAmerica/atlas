import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { STATE_NAME_BY_CODE } from "@/domains/catalog/us-state-grid";

/**
 * State-density summary rendered in Atlas browse surfaces.
 */
export interface BrowseSurfaceState {
  count: number;
  intensity: number;
  state: string;
}

/**
 * Interactive filter option rendered inside a disclosure menu.
 */
export interface FilterDisclosureItem {
  active: boolean;
  key: string;
  label: string;
  onClick: () => void;
}

/**
 * Props for the browse search box.
 */
interface BrowseSearchBoxProps {
  initialQuery: string;
  onSearch: (query: string) => void;
}

/**
 * Keeps the browse search input locally editable while resetting cleanly when
 * the route search param changes. Submits on Enter — no separate button.
 */
export function BrowseSearchBox({ initialQuery, onSearch }: BrowseSearchBoxProps) {
  const [queryDraft, setQueryDraft] = useState(initialQuery);

  return (
    <form
      className="bg-surface-container-lowest flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(queryDraft);
      }}
    >
      <Search className="text-ink-muted h-4 w-4 shrink-0" />
      <input
        value={queryDraft}
        onChange={(event) => {
          setQueryDraft(event.target.value);
        }}
        placeholder="Search place, issue, or name"
        className="type-body-large text-ink-strong placeholder:text-ink-muted w-full bg-transparent outline-none"
      />
      <button
        type="submit"
        className="type-label-large bg-accent hover:bg-accent-deep shrink-0 rounded-full px-3 py-1 text-white transition-colors"
      >
        Search
      </button>
    </form>
  );
}

/**
 * Props for a browse filter disclosure.
 */
interface FilterDisclosureProps {
  count: number;
  items: FilterDisclosureItem[];
  label: string;
}

/**
 * Compact filter disclosure used in the browse header.
 */
export function FilterDisclosure({ count, items, label }: FilterDisclosureProps) {
  return (
    <Popover className="relative lg:min-w-44 lg:flex-1">
      <PopoverButton className="bg-surface-container-lowest hover:bg-surface-container focus-visible:ring-accent flex w-full cursor-pointer items-center justify-between gap-3 rounded-[1rem] px-3 py-2 transition-colors outline-none focus-visible:ring-2">
        <span className="type-label-large text-ink-strong">{label}</span>
        <span className="flex items-center gap-1">
          <span className="type-body-small text-ink-muted">
            {count > 0 ? `${count} selected` : "All"}
          </span>
          <ChevronDown className="text-ink-muted ui-open:rotate-180 h-3.5 w-3.5 transition-transform" />
        </span>
      </PopoverButton>

      <PopoverPanel
        transition
        anchor="bottom start"
        className="border-border bg-surface shadow-soft z-40 mt-2 w-72 origin-top rounded-2xl border p-3 transition duration-200 ease-out data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={[
                "type-label-large rounded-full px-3 py-1.5 transition-colors",
                item.active
                  ? "bg-surface-container-highest text-accent-ink"
                  : "bg-surface-container-low text-ink-soft hover:bg-surface-container-high hover:text-ink-strong",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>
      </PopoverPanel>
    </Popover>
  );
}

/**
 * Props for the browse grid surface.
 */
interface GridSurfaceProps {
  onSelectState: (state: string) => void;
  selectedState?: string;
  states: BrowseSurfaceState[];
}

/**
 * Dense state grid used for non-map browse views.
 */
export function GridSurface({ onSelectState, selectedState, states }: GridSurfaceProps) {
  return (
    <div className="grid gap-x-4 gap-y-3 py-2 md:grid-cols-2 lg:py-3 xl:grid-cols-3">
      {states.map((state) => {
        const isSelected = selectedState === state.state;

        return (
          <button
            key={state.state}
            type="button"
            onClick={() => {
              onSelectState(state.state);
            }}
            className={[
              "border-border border-b pb-3 text-left transition-all",
              isSelected ? "border-ink-strong" : "hover:border-border-strong",
            ].join(" ")}
          >
            <p className="type-title-large text-ink-strong">
              {STATE_NAME_BY_CODE[state.state] ?? state.state}
            </p>
            <p className="type-body-medium text-ink-soft mt-1.5">{state.count} matching records</p>
            <div className="bg-surface-alt mt-3 h-2 rounded-full">
              <div
                className="bg-accent h-full rounded-full"
                style={{ width: `${Math.max(state.intensity * 100, 12)}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Props for the browse list surface.
 */
interface ListSurfaceProps {
  onSelectState: (state: string) => void;
  selectedState?: string;
  states: BrowseSurfaceState[];
}

/**
 * Ranked state list used for browse list mode.
 */
export function ListSurface({ onSelectState, selectedState, states }: ListSurfaceProps) {
  return (
    <div className="divide-border divide-y py-1">
      {states.map((state, index) => (
        <button
          key={state.state}
          type="button"
          onClick={() => {
            onSelectState(state.state);
          }}
          className={[
            "grid w-full gap-2.5 py-3 text-left transition-colors md:grid-cols-[2.5rem_minmax(0,1fr)_auto]",
            selectedState === state.state ? "text-ink-strong" : "hover:text-ink-strong",
          ].join(" ")}
        >
          <span className="type-body-small text-ink-muted">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <p className="type-title-medium text-ink-strong">
              {STATE_NAME_BY_CODE[state.state] ?? state.state}
            </p>
            <p className="type-body-medium text-ink-soft mt-1">{state.state}</p>
          </div>
          <span className="type-body-medium text-ink-muted">{state.count} records</span>
        </button>
      ))}
    </div>
  );
}
