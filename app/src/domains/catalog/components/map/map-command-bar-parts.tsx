import { MapPin, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useId } from "react";
import type { MapPoint } from "@/types";
import type { ActorMatch, PlaceMatch } from "@/domains/catalog/map/map-place-search";

export interface QuickIssueArea {
  slug: string;
  label: string;
}

export interface CommandBarActiveCounts {
  issues: number;
  types: number;
  sources: number;
}

export interface PlaceCommandOption {
  id: string;
  kind: "place";
  place: PlaceMatch;
}

export interface ActorCommandOption {
  actor: ActorMatch;
  id: string;
  kind: "actor";
}

export type CommandOption = PlaceCommandOption | ActorCommandOption;
export type OpenFilter = "issues" | "types" | "sources" | null;

export interface MapFilterItem {
  active: boolean;
  icon?: LucideIcon;
  key: string;
  label: string;
  onClick: () => void;
}

export interface MapFilterMenuDefinition {
  count: number;
  icon: LucideIcon;
  items: MapFilterItem[];
  key: Exclude<OpenFilter, null>;
  label: string;
}

export interface CommandSelectHandlers {
  onSelectActor: (point: MapPoint) => void;
  onSelectPlace: (place: PlaceMatch) => void;
  reset: () => void;
}

export const MAP_COMMAND_NO_RESULTS_ID = "map-command-no-results";

export function selectCommandOption(option: CommandOption, handlers: CommandSelectHandlers): void {
  if (option.kind === "place") {
    handlers.onSelectPlace(option.place);
  } else {
    handlers.onSelectActor(option.actor.point);
  }
  handlers.reset();
}

interface MapFilterTriggerProps {
  count: number;
  icon: LucideIcon;
  label: string;
  menuKey: Exclude<OpenFilter, null>;
  openFilter: OpenFilter;
  setOpenFilter: (value: OpenFilter) => void;
}

export function MapFilterTrigger({
  count,
  icon: Icon,
  label,
  menuKey,
  openFilter,
  setOpenFilter,
}: MapFilterTriggerProps) {
  const buttonId = useId();
  const open = openFilter === menuKey;

  return (
    <button
      id={buttonId}
      type="button"
      aria-expanded={open}
      onClick={() => {
        setOpenFilter(open ? null : menuKey);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpenFilter(null);
        }
      }}
      className="bg-surface-container-lowest hover:bg-surface-container focus-visible:ring-accent flex w-full cursor-pointer items-center justify-between gap-3 rounded-[0.85rem] px-3 py-2 transition-colors outline-none focus-visible:ring-2"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="text-ink-muted h-4 w-4 shrink-0" aria-hidden />
        <span className="type-label-large text-ink-strong truncate">{label}</span>
      </span>
      <span className="type-body-small text-ink-muted">
        {count > 0 ? `${count} selected` : "All"}
      </span>
    </button>
  );
}

interface MapFilterPanelProps {
  menu: MapFilterMenuDefinition;
  setOpenFilter: (value: OpenFilter) => void;
}

export function MapFilterPanel({ menu, setOpenFilter }: MapFilterPanelProps) {
  return (
    <div
      role="group"
      aria-label={menu.label}
      className="bg-surface-container-high/98 shadow-soft border-border-strong mt-1.5 max-h-[min(22rem,calc(100vh-18rem))] overflow-y-auto rounded-[0.9rem] border p-1.5 backdrop-blur-md"
    >
      <div className="grid gap-1">
        {menu.items.map((item) => {
          const ItemIcon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={item.active}
              onClick={() => {
                item.onClick();
                setOpenFilter(null);
              }}
              className={[
                "type-label-large flex min-h-10 w-full items-center gap-2 rounded-[0.7rem] px-2.5 py-2 text-left transition-colors",
                item.active
                  ? "bg-surface-container-highest text-accent-deep"
                  : "text-ink-soft hover:bg-surface-container-lowest hover:text-ink-strong",
              ].join(" ")}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {ItemIcon ? <ItemIcon className="h-3.5 w-3.5" aria-hidden /> : null}
              </span>
              <span className="min-w-0 flex-1">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PlaceOptionProps {
  active: boolean;
  option: PlaceCommandOption;
  onPick: () => void;
}

export function PlaceOption({ active, option, onPick }: PlaceOptionProps) {
  return (
    <li
      id={option.id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onPick}
      className={[
        "hover:bg-surface-container-high flex w-full cursor-pointer items-center gap-2.5 rounded-[0.7rem] px-2.5 py-2 text-left transition-colors",
        active ? "bg-surface-container-high" : "",
      ].join(" ")}
    >
      <MapPin className="text-ink-soft h-4 w-4 shrink-0" aria-hidden />
      <span className="type-body-small text-ink-strong truncate">{option.place.label}</span>
    </li>
  );
}

interface ActorOptionProps {
  active: boolean;
  option: ActorCommandOption;
  onPick: () => void;
}

export function ActorOption({ active, option, onPick }: ActorOptionProps) {
  return (
    <li
      id={option.id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onPick}
      className={[
        "hover:bg-surface-container-high flex w-full cursor-pointer items-center gap-2.5 rounded-[0.7rem] px-2.5 py-2 text-left transition-colors",
        active ? "bg-surface-container-high" : "",
      ].join(" ")}
    >
      <Users className="text-ink-soft h-4 w-4 shrink-0" aria-hidden />
      <span className="type-body-small text-ink-strong truncate">{option.actor.name}</span>
    </li>
  );
}
