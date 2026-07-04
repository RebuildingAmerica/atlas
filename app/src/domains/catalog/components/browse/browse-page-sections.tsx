import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Check, ChevronDown, Compass, MapPin, Search, Tags, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ENTITY_TYPE_LABELS } from "@/domains/catalog/catalog";
import { STATE_NAME_BY_CODE } from "@/domains/catalog/us-state-grid";
import type { EntryType } from "@/types";

/**
 * State-density summary rendered in Atlas browse surfaces.
 */
export interface BrowseSurfaceState {
  count: number;
  intensity: number;
  state: string;
}

export interface BrowseIssueStarter {
  label: string;
  slug: string;
}

/**
 * Interactive filter option rendered inside a disclosure menu.
 */
export interface FilterDisclosureItem {
  active: boolean;
  icon?: LucideIcon;
  key: string;
  label: string;
  onClick: () => void;
}

export interface BrowseIntentChip {
  id: string;
  label: string;
  onRemove: () => void;
}

export interface BrowseCollectionFunnel {
  id: string;
  label: string;
  meta: string;
  onSelect: () => void;
}

interface BrowseExplorationGuidesProps {
  collectionFunnels: BrowseCollectionFunnel[];
  entryTypes: EntryType[];
  issues: BrowseIssueStarter[];
  onSelectEntryType: (entryType: EntryType) => void;
  onSelectIssue: (slug: string) => void;
  onSelectState: (state: string) => void;
  states: BrowseSurfaceState[];
}

/**
 * Props for the browse search box.
 */
interface BrowseSearchBoxProps {
  initialQuery: string;
  onSearch: (query: string) => void;
  placeholder?: string;
}

/**
 * Keeps the browse search input locally editable while resetting cleanly when
 * the route search param changes. Submits on Enter — no separate button.
 */
export function BrowseSearchBox({
  initialQuery,
  onSearch,
  placeholder = "Try housing in Detroit",
}: BrowseSearchBoxProps) {
  const [queryDraft, setQueryDraft] = useState(initialQuery);
  const inputId = useId();

  useEffect(() => {
    setQueryDraft(initialQuery);
  }, [initialQuery]);

  return (
    <form
      className="bg-surface-container-lowest flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        const submittedValue = new FormData(event.currentTarget).get("browse-query");
        onSearch(typeof submittedValue === "string" ? submittedValue : queryDraft);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Search people and groups by issue, place, or name
      </label>
      <Search className="text-ink-muted h-4 w-4 shrink-0" />
      <input
        id={inputId}
        name="browse-query"
        value={queryDraft}
        onChange={(event) => {
          setQueryDraft(event.target.value);
        }}
        placeholder={placeholder}
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
 * Public browse shortcuts that make the directory legible as place-first and
 * issue-first exploration, while still using the canonical browse filters.
 */
export function BrowseExplorationGuides({
  collectionFunnels,
  entryTypes,
  issues,
  onSelectEntryType,
  onSelectIssue,
  onSelectState,
  states,
}: BrowseExplorationGuidesProps) {
  if (states.length === 0 && issues.length === 0 && entryTypes.length === 0) {
    return null;
  }

  const placeStarters = states.slice(0, 3);
  const issueStarters = issues.slice(0, 4);
  const actorTypeStarters = entryTypes.slice(0, 4);
  const funnels = collectionFunnels.slice(0, 3);

  return (
    <section
      aria-label="Browse starting points"
      className="bg-surface-container-lowest rounded-[1.45rem] px-4 py-4 lg:px-5"
    >
      <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MapPin className="text-accent h-4 w-4" aria-hidden />
            <h2 className="type-title-small text-ink-strong">Browse by place</h2>
          </div>
          <p className="type-body-small text-ink-muted mt-1">Popular places.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {placeStarters.map((state) => {
              const stateName = STATE_NAME_BY_CODE[state.state] ?? state.state;
              return (
                <button
                  key={state.state}
                  type="button"
                  aria-label={`${stateName} people and groups ${state.count} records`}
                  onClick={() => {
                    onSelectState(state.state);
                  }}
                  className="bg-surface hover:bg-surface-container text-ink-strong inline-flex max-w-full items-center gap-2 rounded-full px-3 py-2 text-left transition-colors"
                >
                  <span className="type-label-large truncate">{stateName}</span>
                  <span className="type-body-small text-ink-muted shrink-0">
                    {state.count} records
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-border min-w-0 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          <div className="flex items-center gap-2">
            <Tags className="text-accent h-4 w-4" aria-hidden />
            <h2 className="type-title-small text-ink-strong">Browse by issue</h2>
          </div>
          <p className="type-body-small text-ink-muted mt-1">Popular issues.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {issueStarters.map((issue) => (
              <button
                key={issue.slug}
                type="button"
                aria-label={`${issue.label} landscape`}
                onClick={() => {
                  onSelectIssue(issue.slug);
                }}
                className="type-label-large bg-surface text-ink-soft hover:bg-surface-container hover:text-ink-strong rounded-full px-3 py-2 transition-colors"
              >
                {issue.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-border min-w-0 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          <div className="flex items-center gap-2">
            <Users className="text-accent h-4 w-4" aria-hidden />
            <h2 className="type-title-small text-ink-strong">Browse by actor type</h2>
          </div>
          <p className="type-body-small text-ink-muted mt-1">All actor types.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {actorTypeStarters.map((entryType) => (
              <button
                key={entryType}
                type="button"
                aria-label={`${ENTITY_TYPE_LABELS[entryType]} profiles`}
                onClick={() => {
                  onSelectEntryType(entryType);
                }}
                className="type-label-large bg-surface text-ink-soft hover:bg-surface-container hover:text-ink-strong rounded-full px-3 py-2 transition-colors"
              >
                {ENTITY_TYPE_LABELS[entryType]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {funnels.length > 0 ? (
        <div className="border-border mt-4 border-t pt-3">
          <div className="flex items-center gap-2">
            <Compass className="text-accent h-4 w-4" aria-hidden />
            <h2 className="type-title-small text-ink-strong">Guided paths</h2>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {funnels.map((funnel) => (
              <button
                key={funnel.id}
                type="button"
                aria-label={`${funnel.label} guided path`}
                onClick={funnel.onSelect}
                className="bg-surface hover:bg-surface-container min-w-0 rounded-[0.9rem] px-3 py-2 text-left transition-colors"
              >
                <span className="type-label-large text-ink-strong block truncate">
                  {funnel.label}
                </span>
                <span className="type-body-small text-ink-muted mt-1 block truncate">
                  {funnel.meta}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Props for a browse filter disclosure.
 */
interface FilterDisclosureProps {
  count: number;
  icon?: LucideIcon;
  items: FilterDisclosureItem[];
  label: string;
}

/**
 * Compact filter disclosure used in the browse header.
 */
export function FilterDisclosure({ count, icon: Icon, items, label }: FilterDisclosureProps) {
  return (
    <Popover className="relative lg:min-w-44 lg:flex-1">
      <PopoverButton className="bg-surface-container-lowest hover:bg-surface-container focus-visible:ring-accent flex w-full cursor-pointer items-center justify-between gap-3 rounded-[1rem] px-3 py-2 transition-colors outline-none focus-visible:ring-2">
        <span className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon className="text-ink-muted h-4 w-4 shrink-0" aria-hidden /> : null}
          <span className="type-label-large text-ink-strong truncate">{label}</span>
        </span>
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
          {items.map((item) => {
            const ItemIcon = item.icon;

            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={item.active}
                onClick={item.onClick}
                className={[
                  "type-label-large inline-flex items-center gap-1.5 rounded-full py-1.5 pr-2.5 pl-2 transition-colors",
                  item.active
                    ? "bg-surface-container-highest text-accent-ink"
                    : "bg-surface-container-low text-ink-soft hover:bg-surface-container-high hover:text-ink-strong",
                ].join(" ")}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {ItemIcon ? <ItemIcon className="h-3.5 w-3.5" aria-hidden /> : null}
                </span>
                <span>{item.label}</span>
                {item.active ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </PopoverPanel>
    </Popover>
  );
}

interface BrowseIntentChipsProps {
  chips: BrowseIntentChip[];
}

export function BrowseIntentChips({ chips }: BrowseIntentChipsProps) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface-container-lowest flex flex-wrap items-center gap-2 rounded-[1rem] px-3 py-2">
      <span className="type-label-small text-ink-muted">Filters</span>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          aria-label={`Remove ${chip.label}`}
          onClick={chip.onRemove}
          className="type-label-large bg-surface-container-high text-ink-soft hover:text-ink-strong rounded-full px-2.5 py-1 transition-colors"
          title={`Remove ${chip.label}`}
        >
          {chip.label}
        </button>
      ))}
    </div>
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
