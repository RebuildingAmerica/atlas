import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { List } from "lucide-react";
import { MapCommandBar } from "@/domains/catalog/components/map/map-command-bar";
import { MapDetailPanel } from "@/domains/catalog/components/map/map-detail-panel";
import { MapLegend } from "@/domains/catalog/components/map/map-legend";
import { MapPageSurface } from "@/domains/catalog/components/map/map-page-surface";
import { MapStyleProvider } from "@/domains/catalog/components/map/map-style-context";
import {
  MAP_RESULTS_LIST_ID,
  MapResultsPanel,
} from "@/domains/catalog/components/map/map-results-panel";
import {
  ClusterSkeletons,
  MapEmptyState,
  MapErrorState,
} from "@/domains/catalog/components/map/map-states";
import { useMapPage } from "@/domains/catalog/hooks/use-map-page";
import { useMapReveal } from "@/domains/catalog/hooks/use-map-reveal";
import { useDeviceColorScheme } from "@/domains/catalog/hooks/use-device-color-scheme";
import { useReducedMotion } from "@/domains/catalog/hooks/use-reduced-motion";
import { useTaxonomy } from "@rebuildingamerica/atlas-catalog/hooks/use-taxonomy";
import {
  ATLAS_BASEMAP_BACKGROUND_TOKEN,
  atlasBasemapStyle,
} from "@/domains/catalog/map/map-config";
import { announceViewport } from "@rebuildingamerica/atlas-catalog/map/map-summary";
import type { MapNavigate } from "@/domains/catalog/hooks/use-map-page";
import type { FlyToCamera } from "@rebuildingamerica/atlas-catalog/map/map-camera";
import type {
  BrowseRouteSearch,
  MapRouteSearch,
} from "@rebuildingamerica/atlas-catalog/search-state";
import type { MapPointCollection } from "@rebuildingamerica/atlas-api-client";

const MAP_NOTICE_POSITION_CLASS = "absolute top-24 right-3 sm:top-24 sm:right-4";

function useResolvedBasemapBackground(deviceColorScheme: string): string | null {
  const [backgroundColor, setBackgroundColor] = useState<string | null>(null);

  useEffect(() => {
    const value = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(ATLAS_BASEMAP_BACKGROUND_TOKEN)
      .trim();
    setBackgroundColor(value || null);
  }, [deviceColorScheme]);

  return backgroundColor;
}

interface MapPageProps {
  /** The route's search params: shared filters plus a possibly-shared viewport. */
  search: MapRouteSearch;
  /** SSR-seeded continental-US points, hydrated as the first query data. */
  initialPoints?: MapPointCollection;
}

/**
 * The `/map` page — Atlas's explorable map of people and groups, full-bleed.
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
  const [mapCamera, setMapCamera] = useState<FlyToCamera | null>(null);
  const [resultsExpanded, setResultsExpanded] = useState(false);
  const page = useMapPage({
    search,
    navigate,
    map: mapCamera,
    initialPoints,
  });
  const reducedMotion = useReducedMotion();
  const deviceColorScheme = useDeviceColorScheme();
  const basemapBackground = useResolvedBasemapBackground(deviceColorScheme);
  const mapStyle = useMemo(
    () =>
      atlasBasemapStyle(deviceColorScheme, {
        backgroundColor: basemapBackground ?? undefined,
      }),
    [basemapBackground, deviceColorScheme],
  );
  const reveal = useMapReveal({ reducedMotion });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const resultsListRef = useRef<HTMLElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);

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
  const selectionFocusKey = selection
    ? selection.kind === "actor"
      ? `actor:${selection.point.id}`
      : `cluster:${selection.clusterId}`
    : null;
  const hasFetched = pointsQuery.data !== undefined;
  const showMapError = pointsQuery.isError;
  const isEmpty = hasFetched && points.length === 0 && !showMapError;
  const activeCounts = {
    issues: filters.issue_areas.length,
    types: filters.entry_types.length,
    sources: filters.source_types.length,
  };
  const listSearch: BrowseRouteSearch = {
    ...search,
    view: "list",
    offset: 0,
    selected:
      selection?.kind === "cluster"
        ? undefined
        : selection?.kind === "actor"
          ? selection.point.id
          : search.selected,
  };

  const closePanel = () => {
    page.onClosePanel();
    surfaceRef.current?.focus();
  };

  useEffect(() => {
    if (selectionFocusKey) {
      detailPanelRef.current?.focus();
      setResultsExpanded(false);
    }
  }, [selectionFocusKey]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <a
        href={selection ? "#map-detail-panel" : `#${MAP_RESULTS_LIST_ID}`}
        onClick={() => {
          if (selection) {
            detailPanelRef.current?.focus();
          } else {
            setResultsExpanded(true);
            resultsListRef.current?.focus();
          }
        }}
        className="bg-surface-container-high text-ink-strong sr-only z-50 rounded-lg px-4 py-2 focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
      >
        {selection ? "Skip to selected profile" : "Skip to results list"}
      </a>

      <MapStyleProvider
        key={`${deviceColorScheme}:${basemapBackground ?? "transparent"}`}
        initialStyle={mapStyle}
      >
        <MapPageSurface
          surfaceRef={surfaceRef}
          initialView={page.initialView}
          points={points}
          bounds={page.bounds}
          zoom={page.zoom}
          selection={selection}
          reducedMotion={reducedMotion}
          controlsRevealed={reveal.chromeRevealed}
          onMapReady={setMapCamera}
          onLoad={page.onLoad}
          onMoveEnd={page.onMoveEnd}
          onSelectPoint={page.onSelectPoint}
          onSelectCluster={page.onSelectCluster}
        />
      </MapStyleProvider>

      {!hasFetched && !showMapError ? <ClusterSkeletons /> : null}

      <div role="status" aria-live="polite" className="sr-only">
        {announceViewport(points.length)}
      </div>

      <div
        className={`pointer-events-none absolute inset-0 flex flex-col gap-2 p-3 transition-opacity sm:block sm:p-4 ${
          reveal.chromeRevealed ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="flex flex-col items-start gap-2 sm:absolute sm:top-4 sm:left-4">
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
          {!selection ? (
            <Link
              to="/browse"
              search={listSearch}
              className="type-label-medium border-border-strong bg-surface-container-high/92 text-ink-strong hover:bg-surface-container-highest pointer-events-auto inline-flex min-h-10 items-center gap-2 rounded-full border px-4 no-underline shadow-sm backdrop-blur-md"
            >
              <List className="h-4 w-4" aria-hidden />
              List view
            </Link>
          ) : null}
        </div>

        {!selection ? (
          <MapResultsPanel
            panelRef={resultsListRef}
            expanded={resultsExpanded}
            onToggle={() => {
              setResultsExpanded((current) => !current);
            }}
            points={points}
            isLoading={!hasFetched}
            onFocusActor={page.onSelectActor}
          />
        ) : null}

        <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4">
          <MapLegend />
        </div>

        {isEmpty ? (
          <div data-testid="map-empty-notice" className={MAP_NOTICE_POSITION_CLASS}>
            <MapEmptyState
              hasActiveFilters={page.hasActiveFilters}
              onZoomOut={page.onZoomOut}
              onClearFilters={page.onClearFilters}
            />
          </div>
        ) : null}

        {showMapError ? (
          <div data-testid="map-error-notice" className={MAP_NOTICE_POSITION_CLASS}>
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
              panelRef={detailPanelRef}
              selection={selection}
              listSearch={listSearch}
              reducedMotion={reducedMotion}
              onClose={closePanel}
              onSelectMember={page.onSelectMember}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
