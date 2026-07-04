import type { Ref, ReactNode } from "react";
import { MapResultsList } from "@/domains/catalog/components/map/map-results-list";
import { cn } from "@/lib/utils";
import type { MapPoint } from "@/types";

export const MAP_RESULTS_LIST_ID = "map-results-list";

const MAP_RESULTS_PANEL_LABEL = "Civic actors on the map";
const MAP_RESULTS_PANEL_CLASS =
  "bg-surface-container-high/95 shadow-soft border-border-strong focus:ring-accent sr-only z-40 max-h-[min(70vh,36rem)] w-[min(28rem,calc(100vw-1.5rem))] overflow-y-auto rounded-[1.1rem] border p-3 focus:not-sr-only focus:absolute focus:top-16 focus:left-3 focus:ring-2 focus:outline-none focus-within:not-sr-only focus-within:absolute focus-within:top-16 focus-within:left-3 sm:top-20 sm:left-4 sm:focus-within:top-20 sm:focus-within:left-4";
const MAP_RESULTS_HEADING_CLASS = "type-label-large text-ink-strong mb-3 px-1";
const MAP_RESULTS_STATUS_CLASS = "type-body-small text-ink-muted px-1 py-4";

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
      {isLoading ? <p className={MAP_RESULTS_STATUS_CLASS}>Loading</p> : null}
      {!isLoading && points.length === 0 ? (
        <p className={MAP_RESULTS_STATUS_CLASS}>No people or groups in view.</p>
      ) : null}
      {!isLoading && points.length > 0 ? (
        <MapResultsList points={points} onFocusActor={onFocusActor} />
      ) : null}
    </FocusRevealedResultsPanel>
  );
}
