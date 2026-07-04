import { useMemo, useState } from "react";
import { MapPin, Search, Users } from "lucide-react";
import { FilterDisclosure } from "@/domains/catalog/components/browse/browse-page-sections";
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
import { searchActors, searchPlaces } from "@/domains/catalog/map/map-place-search";
import type { ActorMatch, PlaceMatch } from "@/domains/catalog/map/map-place-search";
import type { BrowseFilterKey } from "@/domains/catalog/search-state";
import type { MapPoint } from "@/types";

/** A quick-pick issue area shown in the Issues disclosure. */
export interface QuickIssueArea {
  slug: string;
  label: string;
}

/** The active-filter counts the disclosures badge. */
export interface CommandBarActiveCounts {
  issues: number;
  types: number;
  sources: number;
}

export interface MapCommandBarProps {
  /** The actors loaded for the viewport, searched by the Actors group. */
  points: MapPoint[];
  /** The quick-pick issue areas for the Issues disclosure. */
  quickIssueAreas: QuickIssueArea[];
  /** Currently-selected issue-area slugs. */
  selectedIssueAreas: string[];
  /** Currently-selected entry types. */
  selectedEntryTypes: string[];
  /** Currently-selected source types. */
  selectedSourceTypes: string[];
  /** Whether to offer the Types disclosure at all. */
  showEntryTypeFilter: boolean;
  /** Active-filter counts for the disclosure badges. */
  activeCounts: CommandBarActiveCounts;
  /** Fly to a place and set its filter. */
  onSelectPlace: (place: PlaceMatch) => void;
  /** Fly to an actor and open its panel. */
  onSelectActor: (point: MapPoint) => void;
  /** Toggle a facet filter, sharing the browse URL state. */
  onToggleFilter: (key: BrowseFilterKey, value: string) => void;
}

interface PlaceCommandOption {
  id: string;
  kind: "place";
  place: PlaceMatch;
}

interface ActorCommandOption {
  actor: ActorMatch;
  id: string;
  kind: "actor";
}

type CommandOption = PlaceCommandOption | ActorCommandOption;

interface CommandSelectHandlers {
  onSelectActor: (point: MapPoint) => void;
  onSelectPlace: (place: PlaceMatch) => void;
  reset: () => void;
}

function selectCommandOption(option: CommandOption, handlers: CommandSelectHandlers): void {
  if (option.kind === "place") {
    handlers.onSelectPlace(option.place);
  } else {
    handlers.onSelectActor(option.actor.point);
  }
  handlers.reset();
}

/** A single place option in the menu. */
function PlaceOption({
  active,
  option,
  onPick,
}: {
  active: boolean;
  option: PlaceCommandOption;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        id={option.id}
        type="button"
        role="option"
        aria-selected={active}
        onClick={onPick}
        className={[
          "hover:bg-surface-container-high flex w-full items-center gap-2.5 rounded-[0.7rem] px-2.5 py-2 text-left transition-colors",
          active ? "bg-surface-container-high" : "",
        ].join(" ")}
      >
        <MapPin className="text-ink-soft h-4 w-4 shrink-0" aria-hidden />
        <span className="type-body-small text-ink-strong truncate">{option.place.label}</span>
      </button>
    </li>
  );
}

/** A single actor option in the menu. */
function ActorOption({
  active,
  option,
  onPick,
}: {
  active: boolean;
  option: ActorCommandOption;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        id={option.id}
        type="button"
        role="option"
        aria-selected={active}
        onClick={onPick}
        className={[
          "hover:bg-surface-container-high flex w-full items-center gap-2.5 rounded-[0.7rem] px-2.5 py-2 text-left transition-colors",
          active ? "bg-surface-container-high" : "",
        ].join(" ")}
      >
        <Users className="text-ink-soft h-4 w-4 shrink-0" aria-hidden />
        <span className="type-body-small text-ink-strong truncate">{option.actor.name}</span>
      </button>
    </li>
  );
}

/**
 * The map's top-left command bar — a floating glass card.
 *
 * Its combobox is the single way to "search a place or find an actor": typing
 * suggests Places (cities and states, which fly the camera and set a filter) and
 * Actors (which fly to and open the dot), in two labeled groups so the two
 * meanings never blur. Below it, the same Issues / Types / Sources disclosures
 * the browse list uses drive the identical shared URL state, so narrowing the
 * map and narrowing the list are one act. The menu stays closed until a visitor
 * types, explains a no-match query rather than showing emptiness, and closes on
 * selection or Escape so it never lingers over the country.
 */
export function MapCommandBar({
  points,
  quickIssueAreas,
  selectedIssueAreas,
  selectedEntryTypes,
  selectedSourceTypes,
  showEntryTypeFilter,
  activeCounts,
  onSelectPlace,
  onSelectActor,
  onToggleFilter,
}: MapCommandBarProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const trimmed = query.trim();
  const open = trimmed !== "";
  const places = useMemo(() => (open ? searchPlaces(query) : []), [open, query]);
  const actors = useMemo(() => (open ? searchActors(query, points) : []), [open, points, query]);
  const hasMatches = places.length > 0 || actors.length > 0;
  const placeOptions = useMemo<PlaceCommandOption[]>(
    () =>
      places.map((place, index) => ({
        id: `map-command-option-place-${index}`,
        kind: "place",
        place,
      })),
    [places],
  );
  const actorOptions = useMemo<ActorCommandOption[]>(
    () =>
      actors.map((actor, index) => ({
        actor,
        id: `map-command-option-actor-${index}`,
        kind: "actor",
      })),
    [actors],
  );
  const options = useMemo<CommandOption[]>(
    () => [...placeOptions, ...actorOptions],
    [actorOptions, placeOptions],
  );
  const resolvedActiveIndex =
    activeIndex !== null && activeIndex < options.length ? activeIndex : null;
  const activeOption = resolvedActiveIndex !== null ? options[resolvedActiveIndex] : undefined;

  const reset = () => {
    setQuery("");
    setActiveIndex(null);
  };

  return (
    <div className="bg-surface-container-high/92 shadow-soft border-border-strong pointer-events-auto w-80 max-w-[calc(100vw-2rem)] space-y-2 rounded-[1.1rem] border p-2.5 backdrop-blur-md">
      <div className="relative">
        <div className="bg-surface-container-lowest flex items-center gap-2 rounded-[0.85rem] px-3 py-2">
          <Search className="text-ink-soft h-4 w-4 shrink-0" aria-hidden />
          <input
            role="combobox"
            aria-expanded={open}
            aria-controls="map-command-menu"
            aria-activedescendant={activeOption?.id}
            aria-autocomplete="list"
            aria-label="Search a place or find an actor"
            placeholder="Search a place or find an actor"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                reset();
                return;
              }
              if (!hasMatches) {
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => {
                  if (current === null || current >= options.length - 1) {
                    return 0;
                  }
                  return current + 1;
                });
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => {
                  if (current === null || current <= 0) {
                    return options.length - 1;
                  }
                  return current - 1;
                });
                return;
              }
              if (event.key === "Enter" && activeOption) {
                event.preventDefault();
                selectCommandOption(activeOption, {
                  onSelectActor,
                  onSelectPlace,
                  reset,
                });
              }
            }}
            className="type-body-small text-ink-strong placeholder:text-ink-muted w-full bg-transparent outline-none"
          />
        </div>

        {open ? (
          <div
            id="map-command-menu"
            className="bg-surface-container-high/97 shadow-soft border-border-strong absolute top-full right-0 left-0 z-10 mt-1.5 rounded-[0.9rem] border p-1.5 backdrop-blur-md"
          >
            {hasMatches ? (
              <ul role="listbox" aria-label="Places and actors" className="space-y-1">
                {places.length > 0 ? (
                  <li>
                    <ul role="group" aria-label="Places" className="space-y-0.5">
                      {placeOptions.map((option) => (
                        <PlaceOption
                          key={option.id}
                          active={activeOption?.id === option.id}
                          option={option}
                          onPick={() => {
                            selectCommandOption(option, {
                              onSelectActor,
                              onSelectPlace,
                              reset,
                            });
                          }}
                        />
                      ))}
                    </ul>
                  </li>
                ) : null}
                {actors.length > 0 ? (
                  <li>
                    <ul role="group" aria-label="Actors" className="space-y-0.5">
                      {actorOptions.map((option) => (
                        <ActorOption
                          key={option.id}
                          active={activeOption?.id === option.id}
                          option={option}
                          onPick={() => {
                            selectCommandOption(option, {
                              onSelectActor,
                              onSelectPlace,
                              reset,
                            });
                          }}
                        />
                      ))}
                    </ul>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="type-body-small text-ink-muted px-2.5 py-2">
                No places or actors match “{trimmed}”.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
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
    </div>
  );
}
