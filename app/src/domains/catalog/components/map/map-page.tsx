import { useCallback, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ActorMapSurface } from "@/domains/catalog/components/map/actor-map-surface";
import { MapMarkerLayer } from "@/domains/catalog/components/map/map-marker-layer";
import { MapCommandBar } from "@/domains/catalog/components/map/map-command-bar";
import { MapControls } from "@/domains/catalog/components/map/map-controls";
import { MapDetailPanel } from "@/domains/catalog/components/map/map-detail-panel";
import { MapLegend } from "@/domains/catalog/components/map/map-legend";
import { MapResultsList } from "@/domains/catalog/components/map/map-results-list";
import {
  ClusterSkeletons,
  MapEmptyState,
  MapErrorState,
  SparsityPill,
} from "@/domains/catalog/components/map/map-states";
import { useMapPage } from "@/domains/catalog/hooks/use-map-page";
import { useMapReveal } from "@/domains/catalog/hooks/use-map-reveal";
import { usePanelCamera } from "@/domains/catalog/hooks/use-panel-camera";
import { useReducedMotion } from "@/domains/catalog/hooks/use-reduced-motion";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { announceViewport, sparsityPill } from "@/domains/catalog/map/map-summary";
import type { MapNavigate } from "@/domains/catalog/hooks/use-map-page";
import type { MapSelection } from "@/domains/catalog/map/map-selection";
import type { MapRouteSearch } from "@/domains/catalog/search-state";
import type { MapPointCollection } from "@/types";

/** The detail panel's width in pixels, used to inset the camera beside it. */
const PANEL_WIDTH_PX = 384;

interface MapPageProps {
  /** The route's search params: shared filters plus a possibly-shared viewport. */
  search: MapRouteSearch;
  /** SSR-seeded continental-US points, hydrated as the first query data. */
  initialPoints?: MapPointCollection;
}

/**
 * Keep the open selection framed beside the panel.
 *
 * Lives inside the basemap so it can reach the map through `useMap`; it eases
 * the camera so the selected dot stays visible beside the sliding panel and the
 * two read as one gesture. Renders nothing.
 */
function MapCameraSync({
  selection,
  reducedMotion,
}: {
  selection: MapSelection | null;
  reducedMotion: boolean;
}) {
  usePanelCamera(selection, PANEL_WIDTH_PX, { reducedMotion });
  return null;
}

/**
 * The `/map` page — Atlas's explorable map of civic actors, full-bleed.
 *
 * The map itself is the page: a vector basemap edge-to-edge under the nav, with
 * the live dots over it and the chrome floating above. It reads everything it
 * renders from one behavioral core and arranges it for the experience the plan
 * calls for — a command bar to search a place or an actor (top-left), a legend
 * (bottom-left), camera controls (bottom-right), and an honest set of states
 * that never blank the map. It is also fully reachable without the canvas: a
 * skip link jumps to a parallel results list, a polite live region announces
 * the count after every change, and the detail panel is a non-modal dialog that
 * closes on Escape and hands focus back to the map.
 */
export function MapPage({ search, initialPoints }: MapPageProps) {
  const routerNavigate = useNavigate();
  // Adapt the router's promise-returning navigate to the page's fire-and-forget
  // contract: a URL update is a side effect the page never awaits.
  const navigate = useCallback<MapNavigate>(
    (options) => {
      void routerNavigate(options);
    },
    [routerNavigate],
  );
  const { data: taxonomy } = useTaxonomy();
  const page = useMapPage({ search, navigate, initialPoints });
  const reducedMotion = useReducedMotion();
  const reveal = useMapReveal({ reducedMotion });
  const surfaceRef = useRef<HTMLDivElement>(null);

  const quickIssueAreas = useMemo(() => {
    if (!taxonomy) {
      return [];
    }
    return Object.values(taxonomy)
      .flat()
      .slice(0, 10)
      .map((issue) => ({ slug: issue.slug, label: issue.name }));
  }, [taxonomy]);

  const { points, pointsQuery, selection, filters } = page;
  const hasFetched = pointsQuery.data !== undefined;
  const isEmpty = hasFetched && points.length === 0 && !pointsQuery.isError;
  const pill = sparsityPill(points);
  const activeCounts = {
    issues: filters.issue_areas.length,
    types: filters.entry_types.length,
    sources: filters.source_types.length,
  };

  const closePanel = () => {
    page.onClosePanel();
    surfaceRef.current?.focus();
  };

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full overflow-hidden">
      <a
        href="#map-results-list"
        className="bg-surface-container-high text-ink-strong sr-only z-50 rounded-lg px-4 py-2 focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
      >
        Skip to results list
      </a>

      <div ref={surfaceRef} tabIndex={-1} className="absolute inset-0 outline-none">
        <ActorMapSurface
          initialView={page.initialView}
          onLoad={page.onLoad}
          onMoveEnd={page.onMoveEnd}
        >
          <MapCameraSync selection={selection} reducedMotion={reducedMotion} />
          {page.bounds ? (
            <MapMarkerLayer
              points={points}
              bounds={page.bounds}
              zoom={page.zoom}
              selectedId={selection?.kind === "actor" ? selection.point.id : undefined}
              reducedMotion={reducedMotion}
              onSelectPoint={page.onSelectPoint}
              onSelectCluster={page.onSelectCluster}
            />
          ) : null}
        </ActorMapSurface>
      </div>

      {!hasFetched ? <ClusterSkeletons /> : null}

      <div role="status" aria-live="polite" className="sr-only">
        {announceViewport(points.length)}
      </div>

      <div
        className={`pointer-events-none absolute inset-0 p-3 transition-opacity sm:p-4 ${
          reveal.chromeRevealed ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="absolute top-3 left-3 sm:top-4 sm:left-4">
          <MapCommandBar
            points={points}
            quickIssueAreas={quickIssueAreas}
            selectedIssueAreas={filters.issue_areas}
            selectedEntryTypes={filters.entry_types}
            selectedSourceTypes={filters.source_types}
            showEntryTypeFilter
            activeCounts={activeCounts}
            onSelectPlace={page.onSelectPlace}
            onSelectActor={page.onSelectActor}
            onToggleFilter={page.onToggleFilter}
          />
        </div>

        {pill ? (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 sm:top-4">
            <SparsityPill label={pill} />
          </div>
        ) : null}

        <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4">
          <MapLegend />
        </div>

        <div className="absolute right-3 bottom-3 sm:right-4 sm:bottom-4">
          <MapControls reducedMotion={reducedMotion} />
        </div>

        {isEmpty ? (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <MapEmptyState
              hasActiveFilters={page.hasActiveFilters}
              onZoomOut={page.onZoomOut}
              onClearFilters={page.onClearFilters}
            />
          </div>
        ) : null}

        {pointsQuery.isError ? (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <MapErrorState
              onRetry={() => {
                void pointsQuery.refetch();
              }}
            />
          </div>
        ) : null}

        {selection ? (
          <div
            className="bg-surface-container-low/97 shadow-soft border-border-strong pointer-events-auto absolute top-3 right-3 bottom-3 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[1.1rem] border backdrop-blur-md sm:top-4 sm:right-4 sm:bottom-4"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closePanel();
              }
            }}
          >
            <MapDetailPanel
              selection={selection}
              reducedMotion={reducedMotion}
              onClose={closePanel}
              onSelectMember={page.onSelectMember}
            />
          </div>
        ) : null}
      </div>

      <section id="map-results-list" aria-label="Civic actors on the map" className="sr-only">
        <h2>Civic actors on the map</h2>
        <MapResultsList points={points} isLoading={!hasFetched} onFocusActor={page.onSelectActor} />
      </section>
    </div>
  );
}
