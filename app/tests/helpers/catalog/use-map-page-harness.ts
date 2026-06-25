import { type Mock, vi } from "vitest";
import type { FakeMap } from "./fake-map";
import type { MapNavigate } from "@/domains/catalog/hooks/use-map-page";
import type { ReadableMap } from "@/domains/catalog/map/map-readout";
import type { MapPointCollection, MapPointParams } from "@/types";

/** The minimal move/load event the page reads a viewport off of. */
export interface MapEventLike {
  target: ReadableMap;
}

/** Wrap a fake map as the move/load event the page handlers receive. */
export function moveEvent(map: FakeMap): MapEventLike {
  return { target: map };
}

/** The single argument shape the navigate spy is called with. */
type NavigateArg = Parameters<MapNavigate>[0];

/** Resolve a navigate call's `search` (function or literal) into a plain patch. */
export function navigateSearch(
  arg: NavigateArg | undefined,
  previous: Record<string, unknown> = {},
): Record<string, unknown> | undefined {
  if (!arg) {
    return undefined;
  }
  return typeof arg.search === "function" ? arg.search(previous) : arg.search;
}

/** Options the page passes alongside its viewport params to `useMapPoints`. */
export interface UseMapPointsOptionsLike {
  initialData?: MapPointCollection;
  enabled?: boolean;
}

/** Records of every `useMapPoints` call so a test can assert the wiring. */
interface MapPointsRecorder {
  params: (MapPointParams | null)[];
  options: (UseMapPointsOptionsLike | undefined)[];
}

const recorder: MapPointsRecorder = { params: [], options: [] };

/** The result the mocked `useMapPoints` returns; overridable per test. */
let pointsResult: {
  data: MapPointCollection | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = {
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

/**
 * The mock standing in for `useMapPoints`, recording each call's params and
 * options so the page's data wiring can be asserted without a real query.
 */
export const mapPageMapPointsMock = vi.fn(
  (params: MapPointParams | null, options?: UseMapPointsOptionsLike) => {
    recorder.params.push(params);
    recorder.options.push(options);
    return pointsResult;
  },
);

/** A typed navigate spy whose recorded calls expose the `search` patch. */
export type NavigateSpy = Mock<MapNavigate>;

/** The spies a `useMapPage` test drives and asserts on. */
export interface MapPageMocks {
  navigate: NavigateSpy;
}

/** Holds the navigate spy and the fake map the `useMap()` mock reaches for. */
interface MapPageHarnessState {
  mocks: MapPageMocks | null;
  map: FakeMap | null;
}

const harnessState: MapPageHarnessState = { mocks: null, map: null };

/**
 * Reset the recorders and return fresh spies for one `useMapPage` test.
 *
 * @returns The navigate spy the hook is given.
 */
export function installMapPageMocks(): MapPageMocks {
  recorder.params = [];
  recorder.options = [];
  pointsResult = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  mapPageMapPointsMock.mockClear();
  const navigate: NavigateSpy = vi.fn();
  harnessState.mocks = { navigate };
  harnessState.map = null;
  return harnessState.mocks;
}

/** Return the installed mocks, failing loudly if a test forgot to install them. */
export function requireMapPageMocks(): MapPageMocks {
  if (!harnessState.mocks) {
    throw new Error("Map page mocks were not installed for this test.");
  }
  return harnessState.mocks;
}

/** Place a fake map for the next `useMap()` read; pass `null` for "not mounted". */
export function setMapPageMap(map: FakeMap | null): void {
  harnessState.map = map;
}

/** The map the `useMap()` mock should hand the hook. */
export function currentMapPageMap(): FakeMap | null {
  return harnessState.map;
}

/** Read the `search` patch from a navigate spy's most recent call. */
export function lastNavigateSearch(
  navigate: NavigateSpy,
  previous: Record<string, unknown> = {},
): Record<string, unknown> | undefined {
  return navigateSearch(navigate.mock.calls.at(-1)?.[0], previous);
}

/** Override what the mocked `useMapPoints` returns for the next render. */
export function setMapPointsResult(next: Partial<typeof pointsResult>): void {
  pointsResult = { ...pointsResult, ...next };
}

/** Reader for the recorded `useMapPoints` calls. */
export function readMapPageMocks() {
  return {
    lastParams: (): MapPointParams | null | undefined => recorder.params.at(-1),
    lastOptions: (): UseMapPointsOptionsLike | undefined => recorder.options.at(-1),
  };
}
