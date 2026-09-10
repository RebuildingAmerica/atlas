import type { Ref, ReactNode } from "react";
import { MapResultsList } from "@/domains/catalog/components/map/map-results-list";
import { ENTITY_TYPE_LABELS, humanize } from "@rebuildingamerica/atlas-catalog/catalog";
import { cn } from "@/lib/utils";
import type { EntryType, MapPoint } from "@rebuildingamerica/atlas-api-client";

export const MAP_RESULTS_LIST_ID = "map-results-list";

const MAP_RESULTS_PANEL_LABEL = "Civic actors on the map";
const MAP_RESULTS_PANEL_CLASS =
  "bg-surface-container-high/95 shadow-soft border-border-strong focus:ring-accent pointer-events-auto absolute right-3 top-20 z-40 max-h-[min(72vh,38rem)] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto rounded-[1.1rem] border p-3 backdrop-blur-md focus:ring-2 focus:outline-none sm:right-4 sm:top-24";
const MAP_RESULTS_HEADING_CLASS = "type-label-large text-ink-strong px-1";
const MAP_RESULTS_STATUS_CLASS = "type-body-small text-ink-muted px-1 py-4";
const LANDSCAPE_LIMIT = 3;

interface LandscapeStat {
  label: string;
  value: string;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countByValue<T extends string>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  values.forEach((value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return counts;
}

function topValues<T extends string>(counts: Map<T, number>): T[] {
  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .slice(0, LANDSCAPE_LIMIT)
    .map(([value]) => value);
}

function issueLabel(issueArea: string): string {
  return humanize(issueArea.replaceAll("-", "_"));
}

function landscapeStats(points: MapPoint[]): LandscapeStat[] {
  const places = new Set(points.flatMap((point) => (point.place_label ? [point.place_label] : [])));
  const sourceCount = points.reduce((total, point) => total + point.source_count, 0);
  return [
    { label: "Actors", value: pluralize(points.length, "person or group", "people and groups") },
    { label: "Places", value: pluralize(places.size, "place", "places") },
    { label: "Sources", value: pluralize(sourceCount, "source", "sources") },
  ];
}

function issueLabels(points: MapPoint[]): string[] {
  return topValues(countByValue(points.flatMap((point) => point.issue_areas))).map(issueLabel);
}

function typeLabels(points: MapPoint[]): string[] {
  return topValues(countByValue(points.map((point) => point.type))).map(
    (type: EntryType) => ENTITY_TYPE_LABELS[type],
  );
}

function LandscapeSummary({ points }: { points: MapPoint[] }) {
  if (points.length === 0) {
    return null;
  }
  const issues = issueLabels(points);
  const types = typeLabels(points);
  return (
    <div className="border-border-subtle mb-3 border-b px-1 pb-3">
      <p className="type-label-small text-ink-soft uppercase">Landscape</p>
      <dl className="mt-2 grid grid-cols-3 gap-2">
        {landscapeStats(points).map((stat) => (
          <div key={stat.label}>
            <dt className="type-label-small text-ink-muted">{stat.label}</dt>
            <dd className="type-body-small text-ink-strong font-semibold">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[...issues, ...types].map((label) => (
          <span
            key={label}
            className="border-border-subtle bg-surface-container-lowest type-label-small text-ink-soft rounded-full border px-2 py-1"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

interface FocusRevealedResultsPanelProps {
  /** Stable fragment target for the skip link. */
  id: string;
  /** Accessible name and visible heading for the revealed panel. */
  label: string;
  /** Imperative focus target used by the skip link. */
  panelRef?: Ref<HTMLElement>;
  /** Extra layout classes for one-off map placements. */
  className?: string;
  /** The panel body, usually a status line or the row list. */
  children: ReactNode;
}

function FocusRevealedResultsPanel({
  id,
  label,
  panelRef,
  className,
  children,
}: FocusRevealedResultsPanelProps) {
  return (
    <section
      id={id}
      ref={panelRef}
      tabIndex={-1}
      aria-label={label}
      className={cn(MAP_RESULTS_PANEL_CLASS, className)}
    >
      <h2 className={MAP_RESULTS_HEADING_CLASS}>{label}</h2>
      {children}
    </section>
  );
}

interface MapResultsPanelProps {
  /** The actors currently placed in the viewport. */
  points: MapPoint[];
  /** Whether the viewport's actors are still being fetched. */
  isLoading: boolean;
  /** Bring an actor's dot into focus on the map from its list row. */
  onFocusActor: (point: MapPoint) => void;
  /** Stable fragment target for the skip link. */
  id?: string;
  /** Accessible name and visible heading for the revealed panel. */
  label?: string;
  /** Imperative focus target used by the skip link. */
  panelRef?: Ref<HTMLElement>;
  /** Extra layout classes for one-off map placements. */
  className?: string;
}

/**
 * The keyboard-accessible results shell for the map.
 *
 * It owns the skip target, reveal-on-focus layout, heading, and quiet loading
 * and empty states so `MapResultsList` can stay focused on rendering point rows.
 */
export function MapResultsPanel({
  points,
  isLoading,
  onFocusActor,
  id = MAP_RESULTS_LIST_ID,
  label = MAP_RESULTS_PANEL_LABEL,
  panelRef,
  className,
}: MapResultsPanelProps) {
  return (
    <FocusRevealedResultsPanel id={id} label={label} panelRef={panelRef} className={className}>
      <LandscapeSummary points={points} />
      {isLoading ? <p className={MAP_RESULTS_STATUS_CLASS}>Loading</p> : null}
      {!isLoading && points.length === 0 ? (
        <p className={MAP_RESULTS_STATUS_CLASS}>No people or groups in this area.</p>
      ) : null}
      {!isLoading && points.length > 0 ? (
        <MapResultsList points={points} onFocusActor={onFocusActor} />
      ) : null}
    </FocusRevealedResultsPanel>
  );
}
