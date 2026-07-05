// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  MAP_POINTS_DEBOUNCE_MS,
  mapPointsQueryKey,
  roundBounds,
  useMapPoints,
} from "@/domains/catalog/hooks/use-map-points";
import type { MapPointParams } from "@/types";
import { HOUSING_VIEWPORT, JITTERED_BOUNDS } from "../../../../fixtures/catalog/map";
import { lastQueryConfig } from "../../../../helpers/catalog/use-map-points-harness";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  keepPreviousData: Symbol("keepPreviousData"),
  mapPoints: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  keepPreviousData: mocks.keepPreviousData,
}));

vi.mock("@/lib/api", () => ({
  api: {
    entries: {
      mapPoints: mocks.mapPoints,
    },
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.useQuery.mockReset();
  mocks.useQuery.mockReturnValue({ data: null, isLoading: false });
  mocks.mapPoints.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("roundBounds", () => {
  it("rounds each edge to two decimals so micro-pans collapse onto one key", () => {
    expect(roundBounds(JITTERED_BOUNDS)).toEqual({
      minLng: -125,
      minLat: 24.01,
      maxLng: -66.5,
      maxLat: 49.5,
    });
  });
});

describe("mapPointsQueryKey", () => {
  it("keys on the rounded bounds plus the verbatim facet filters", () => {
    const viewport: MapPointParams = {
      ...HOUSING_VIEWPORT,
      source_patterns: ["multi_source"],
    };

    expect(mapPointsQueryKey(viewport)).toEqual([
      "map-points",
      { minLng: -125, minLat: 24.01, maxLng: -66.5, maxLat: 49.5 },
      { issue_areas: ["housing_affordability"], source_patterns: ["multi_source"] },
    ]);
  });
});

describe("useMapPoints", () => {
  it("configures the query with keepPreviousData placeholder and an enabled, known viewport", () => {
    renderHook(() => useMapPoints(HOUSING_VIEWPORT));
    const config = lastQueryConfig(mocks.useQuery);
    expect(config.placeholderData).toBe(mocks.keepPreviousData);
    expect(config.enabled).toBe(true);
    expect(config.queryKey).toEqual(mapPointsQueryKey(HOUSING_VIEWPORT));
  });

  it("only fetches the viewport after the debounce window settles", () => {
    const initial: MapPointParams = { bounds: JITTERED_BOUNDS };
    const { rerender } = renderHook(({ params }) => useMapPoints(params), {
      initialProps: { params: initial },
    });

    const moved: MapPointParams = {
      bounds: { minLng: -90, minLat: 30, maxLng: -80, maxLat: 40 },
    };
    rerender({ params: moved });

    // Before the debounce elapses the query key still reflects the prior viewport.
    expect(lastQueryConfig(mocks.useQuery).queryKey).toEqual(mapPointsQueryKey(initial));

    act(() => {
      vi.advanceTimersByTime(MAP_POINTS_DEBOUNCE_MS);
    });

    expect(lastQueryConfig(mocks.useQuery).queryKey).toEqual(mapPointsQueryKey(moved));
  });

  it("delegates the query function to the api map-points fetcher", async () => {
    mocks.mapPoints.mockResolvedValueOnce({ points: [], total: 0, capped: false });
    renderHook(() => useMapPoints(HOUSING_VIEWPORT));
    await lastQueryConfig(mocks.useQuery).queryFn();
    expect(mocks.mapPoints).toHaveBeenCalledWith(HOUSING_VIEWPORT);
  });

  it("disables and idles the query when the viewport is not yet known", () => {
    renderHook(() => useMapPoints(null));
    const config = lastQueryConfig(mocks.useQuery);
    expect(config.enabled).toBe(false);
    expect(config.queryKey).toEqual(["map-points", "idle"]);
  });

  it("throws loudly rather than fetching an empty viewport if the idle query ever runs", () => {
    renderHook(() => useMapPoints(null));
    expect(() => lastQueryConfig(mocks.useQuery).queryFn()).toThrow(
      "useMapPoints query ran without a known viewport.",
    );
    expect(mocks.mapPoints).not.toHaveBeenCalled();
  });

  it("clears the debounced viewport when the params drop back to null", () => {
    const initialProps: { params: MapPointParams | null } = { params: HOUSING_VIEWPORT };
    const { rerender } = renderHook(({ params }) => useMapPoints(params), {
      initialProps,
    });

    rerender({ params: null });

    act(() => {
      vi.advanceTimersByTime(MAP_POINTS_DEBOUNCE_MS);
    });

    const config = lastQueryConfig(mocks.useQuery);
    expect(config.enabled).toBe(false);
    expect(config.queryKey).toEqual(["map-points", "idle"]);
  });

  it("respects an explicit enabled override even with a known viewport", () => {
    renderHook(() => useMapPoints(HOUSING_VIEWPORT, { enabled: false }));
    expect(lastQueryConfig(mocks.useQuery).enabled).toBe(false);
  });

  it("hydrates from server-seeded initial data", () => {
    const seeded = { points: [], total: 0, capped: false };
    renderHook(() => useMapPoints(HOUSING_VIEWPORT, { initialData: seeded }));
    expect(lastQueryConfig(mocks.useQuery).initialData).toBe(seeded);
  });
});
