import { type Mock, vi } from "vitest";
import { makeBrowseSearchState } from "../../fixtures/catalog/map";
import type { MapNavigate, useMapPage } from "@/domains/catalog/hooks/use-map-page";
import type { MapRouteSearch } from "@/domains/catalog/search-state";
import type { MapSelection } from "@/domains/catalog/map/map-selection";
import type { MapBounds, MapPoint, TaxonomyResponse } from "@rebuildingamerica/atlas-api-client";

/** The continental-US bounds the page hook reports until a test nulls them. */
const DEFAULT_BOUNDS: MapBounds = { minLng: -125, minLat: 24, maxLng: -66.5, maxLat: 49.5 };

let chromeRevealed = true;

/** Override whether the staged reveal has finished, for the chrome-hidden branch. */
export function setMapPageChromeRevealed(next: boolean): void {
  chromeRevealed = next;
}

/** Whether the page's reveal mock should report the chrome as visible. */
export function currentMapPageChromeRevealed(): boolean {
  return chromeRevealed;
}

/** A taxonomy with one issue, so the command bar's Issues disclosure has a pick. */
const DEFAULT_TAXONOMY: TaxonomyResponse = {
  housing: [{ slug: "housing-affordability", name: "Housing", description: "" }],
};

let taxonomy: TaxonomyResponse | undefined = DEFAULT_TAXONOMY;

/** Override the taxonomy the page's `useTaxonomy` mock returns next render. */
export function setMapPageTaxonomy(next: TaxonomyResponse | undefined): void {
  taxonomy = next;
}

/** The taxonomy the page's `useTaxonomy` mock should return. */
export function currentMapPageTaxonomy(): TaxonomyResponse | undefined {
  return taxonomy;
}

/** The shape `useMapPage` returns, as the component consumes it. */
type MapPageState = ReturnType<typeof useMapPage>;

/** The query slice the page reads off the hook's `pointsQuery`. */
interface PointsQueryLike {
  data: { points: MapPoint[] } | undefined;
  isError: boolean;
  refetch: () => void;
}

/** The callbacks a `MapPage` test asserts were wired to the chrome. */
export interface MapPageHandlers {
  onMoveEnd: Mock<MapPageState["onMoveEnd"]>;
  onLoad: Mock<MapPageState["onLoad"]>;
  onToggleFilter: Mock<MapPageState["onToggleFilter"]>;
  onSelectPlace: Mock<MapPageState["onSelectPlace"]>;
  onSelectActor: Mock<MapPageState["onSelectActor"]>;
  onSelectPoint: Mock<MapPageState["onSelectPoint"]>;
  onSelectCluster: Mock<MapPageState["onSelectCluster"]>;
  onSelectMember: Mock<MapPageState["onSelectMember"]>;
  onClosePanel: Mock<MapPageState["onClosePanel"]>;
  onZoomOut: Mock<MapPageState["onZoomOut"]>;
  onClearFilters: Mock<MapPageState["onClearFilters"]>;
}

interface HarnessState {
  points: MapPoint[];
  selection: MapSelection | null;
  pointsQuery: PointsQueryLike;
  hasActiveFilters: boolean;
  bounds: MapBounds | null;
}

/** A partial state patch, where the nested points query may also be partial. */
type HarnessStatePatch = Partial<Omit<HarnessState, "pointsQuery">> & {
  pointsQuery?: Partial<PointsQueryLike>;
};

/** What `installMapPageComponentMocks` hands a test to drive the page. */
export interface MapPageHarness {
  handlers: MapPageHandlers;
  setState: (next: HarnessStatePatch) => void;
}

function freshHandlers(): MapPageHandlers {
  return {
    onMoveEnd: vi.fn(),
    onLoad: vi.fn(),
    onToggleFilter: vi.fn(),
    onSelectPlace: vi.fn(),
    onSelectActor: vi.fn(),
    onSelectPoint: vi.fn(),
    onSelectCluster: vi.fn(),
    onSelectMember: vi.fn(),
    onClosePanel: vi.fn(),
    onZoomOut: vi.fn(),
    onClearFilters: vi.fn(),
  };
}

interface HarnessInternals {
  handlers: MapPageHandlers;
  state: HarnessState;
  searches: MapRouteSearch[];
  initialPointsLoadFailures: boolean[];
  navigates: MapNavigate[];
  harness: MapPageHarness | null;
}

const internals: HarnessInternals = {
  handlers: freshHandlers(),
  state: {
    points: [],
    selection: null,
    pointsQuery: { data: { points: [] }, isError: false, refetch: vi.fn() },
    hasActiveFilters: false,
    bounds: DEFAULT_BOUNDS,
  },
  searches: [],
  initialPointsLoadFailures: [],
  navigates: [],
  harness: null,
};

/**
 * The mock standing in for `useMapPage`, returning a hook value built from the
 * harness state plus the spy handlers, and recording the search and navigate it
 * was given so a test can drive the page's promise-to-void navigate adapter.
 */
export const mapPageHookMock = vi.fn(
  (options: {
    initialPointsLoadFailed?: boolean;
    search: MapRouteSearch;
    navigate: MapNavigate;
  }): MapPageState => {
    internals.searches.push(options.search);
    internals.initialPointsLoadFailures.push(options.initialPointsLoadFailed ?? false);
    internals.navigates.push(options.navigate);
    const { state, handlers } = internals;
    return {
      filters: makeBrowseSearchState(),
      initialView: { center: { lng: -96, lat: 38.5 }, zoom: 3.4 },
      bounds: state.bounds,
      zoom: 4,
      points: state.points,
      pointsQuery: state.pointsQuery as MapPageState["pointsQuery"],
      selection: state.selection,
      hasActiveFilters: state.hasActiveFilters,
      ...handlers,
    };
  },
);

/** Reset the harness and return the controls for one `MapPage` test. */
export function installMapPageComponentMocks(): MapPageHarness {
  internals.handlers = freshHandlers();
  internals.state = {
    points: [],
    selection: null,
    pointsQuery: { data: { points: [] }, isError: false, refetch: vi.fn() },
    hasActiveFilters: false,
    bounds: DEFAULT_BOUNDS,
  };
  internals.searches = [];
  internals.initialPointsLoadFailures = [];
  internals.navigates = [];
  taxonomy = DEFAULT_TAXONOMY;
  chromeRevealed = true;
  mapPageHookMock.mockClear();

  internals.harness = {
    handlers: internals.handlers,
    setState: (next) => {
      const pointsQuery = next.pointsQuery
        ? { ...internals.state.pointsQuery, ...next.pointsQuery }
        : internals.state.pointsQuery;
      internals.state = { ...internals.state, ...next, pointsQuery };
    },
  };
  return internals.harness;
}

/** Return the installed harness, failing loudly if a test forgot to install it. */
export function requireMapPageHarness(): MapPageHarness {
  if (!internals.harness) {
    throw new Error("Map page component mocks were not installed for this test.");
  }
  return internals.harness;
}

/** Reader for the searches and navigate the page handed the hook. */
export function readMapPageHarness() {
  return {
    lastSearch: (): MapRouteSearch | undefined => internals.searches.at(-1),
    lastInitialPointsLoadFailed: (): boolean | undefined =>
      internals.initialPointsLoadFailures.at(-1),
    lastNavigate: (): MapNavigate | undefined => internals.navigates.at(-1),
  };
}
