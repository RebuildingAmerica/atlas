// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useMapPage } from "@/domains/catalog/hooks/use-map-page";
import { CONUS_VIEW } from "@rebuildingamerica/atlas-catalog/map/map-viewport";
import { makePoint } from "../../../../helpers/catalog/map-clustering-harness";
import { makeFakeMap } from "../../../../helpers/catalog/fake-map";
import {
  installMapPageMocks,
  lastNavigateSearch,
  moveEvent,
  readMapPageMocks,
  requireMapPageMocks,
} from "../../../../helpers/catalog/use-map-page-harness";
import type { PlaceMatch } from "@/domains/catalog/map/map-place-search";

vi.mock("@/domains/catalog/hooks/use-map-points", async () => {
  const { mapPageMapPointsMock } = await import("../../../../helpers/catalog/use-map-page-harness");
  return { useMapPoints: mapPageMapPointsMock };
});

beforeEach(() => {
  installMapPageMocks();
});

afterEach(cleanup);

describe("useMapPage", () => {
  it("opens unfiltered on the continental US when no search is shared", () => {
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate }),
    );
    expect(result.current.initialView).toEqual(CONUS_VIEW);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it("starts with continental-US bounds so seeded markers render before the basemap loads", () => {
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate }),
    );

    expect(result.current.bounds).toEqual({
      minLng: -125,
      minLat: 24,
      maxLng: -66.5,
      maxLat: 49.5,
    });
    expect(readMapPageMocks().lastParams()?.bounds).toEqual(result.current.bounds);
  });

  it("starts shared viewport URLs with bounds near the saved camera", () => {
    const { result } = renderHook(() =>
      useMapPage({
        search: { lng: -96.8, lat: 32.78, z: 9 },
        navigate: requireMapPageMocks().navigate,
      }),
    );

    expect(result.current.bounds?.minLng).toBeGreaterThan(-100);
    expect(result.current.bounds?.maxLng).toBeLessThan(-93);
    expect(readMapPageMocks().lastParams()?.bounds).toEqual(result.current.bounds);
  });

  it("reads the viewport off the map after a move and fetches its actors", () => {
    const map = makeFakeMap({
      center: { lng: -96.8, lat: 32.78 },
      zoom: 7,
      bounds: { sw: { lng: -100, lat: 30 }, ne: { lng: -94, lat: 35 } },
    });
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate }),
    );

    act(() => {
      result.current.onMoveEnd(moveEvent(map));
    });

    const lastParams = readMapPageMocks().lastParams();
    expect(lastParams?.bounds).toEqual({ minLng: -100, minLat: 30, maxLng: -94, maxLat: 35 });
    expect(result.current.zoom).toBe(7);
  });

  it("writes the settled camera back to the URL so a link restores it", () => {
    const map = makeFakeMap({
      center: { lng: -96.8, lat: 32.78 },
      zoom: 7,
      bounds: { sw: { lng: -100, lat: 30 }, ne: { lng: -94, lat: 35 } },
    });
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate }),
    );

    act(() => {
      result.current.onMoveEnd(moveEvent(map));
    });

    expect(requireMapPageMocks().navigate).toHaveBeenCalled();
    expect(lastNavigateSearch(requireMapPageMocks().navigate, { existing: true })).toMatchObject({
      existing: true,
      lng: -96.8,
      lat: 32.78,
      z: 7,
    });
  });

  it("seeds the viewport off the map on first load too", () => {
    const map = makeFakeMap({
      center: { lng: -96, lat: 38 },
      zoom: 4,
      bounds: { sw: { lng: -125, lat: 24 }, ne: { lng: -66.5, lat: 49.5 } },
    });
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate }),
    );
    act(() => {
      result.current.onLoad(moveEvent(map));
    });
    expect(readMapPageMocks().lastParams()?.bounds.minLng).toBe(-125);
  });

  it("toggles a facet filter into the shared URL state", () => {
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate }),
    );
    act(() => {
      result.current.onToggleFilter("issue_areas", "housing-affordability");
    });
    expect(lastNavigateSearch(requireMapPageMocks().navigate)).toMatchObject({
      issue_areas: "housing-affordability",
    });
  });

  it("flies to a place and sets its city filter when one is chosen", () => {
    const map = makeFakeMap({
      center: { lng: -96, lat: 38 },
      zoom: 4,
      bounds: { sw: { lng: -125, lat: 24 }, ne: { lng: -66.5, lat: 49.5 } },
    });
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate, map }),
    );
    const place: PlaceMatch = {
      kind: "city",
      label: "Dallas, TX",
      anchor: { lng: -96.8, lat: 32.78 },
      stateCode: "TX",
      cityKey: "Dallas, TX",
    };
    act(() => {
      result.current.onSelectPlace(place);
    });

    expect(map.flyTo).toHaveBeenCalledOnce();
    expect(lastNavigateSearch(requireMapPageMocks().navigate)).toMatchObject({
      cities: "Dallas, TX",
      states: "TX",
    });
  });

  it("flies to a state and sets only its state filter", () => {
    const map = makeFakeMap({
      center: { lng: -96, lat: 38 },
      zoom: 4,
      bounds: { sw: { lng: -125, lat: 24 }, ne: { lng: -66.5, lat: 49.5 } },
    });
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate, map }),
    );
    const place: PlaceMatch = {
      kind: "state",
      label: "Texas",
      anchor: { lng: -97, lat: 31 },
      stateCode: "TX",
    };
    act(() => {
      result.current.onSelectPlace(place);
    });
    const next = lastNavigateSearch(requireMapPageMocks().navigate);
    expect(next).toMatchObject({ states: "TX" });
    expect(next?.cities).toBeUndefined();
  });

  it("opens an actor's panel and flies to it when chosen from search", () => {
    const map = makeFakeMap({
      center: { lng: -96, lat: 38 },
      zoom: 4,
      bounds: { sw: { lng: -125, lat: 24 }, ne: { lng: -66.5, lat: 49.5 } },
    });
    const point = makePoint({ id: "1", name: "Dallas Housing Trust", lng: -96.8, lat: 32.78 });
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate, map }),
    );
    act(() => {
      result.current.onSelectActor(point);
    });
    expect(result.current.selection?.kind).toBe("actor");
    expect(map.flyTo).toHaveBeenCalledOnce();
  });

  it("opens an actor panel from a clicked dot and closes it again", () => {
    const point = makePoint({ id: "1" });
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate }),
    );
    act(() => {
      result.current.onSelectPoint(point, { lng: -96.8, lat: 32.78 });
    });
    expect(result.current.selection?.kind).toBe("actor");
    act(() => {
      result.current.onClosePanel();
    });
    expect(result.current.selection).toBeNull();
  });

  it("opens a cluster's crowd and steps into one of its members", () => {
    const members = [makePoint({ id: "1" }), makePoint({ id: "2" })];
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate }),
    );
    act(() => {
      result.current.onSelectCluster(members, { lng: -96.8, lat: 32.78 }, 9);
    });
    expect(result.current.selection?.kind).toBe("cluster");
    const second = members[1];
    if (!second) {
      throw new Error("Expected a second cluster member.");
    }
    act(() => {
      result.current.onSelectMember(second);
    });
    expect(result.current.selection?.kind).toBe("actor");
  });

  it("clears every filter back to a bare map view", () => {
    const { result } = renderHook(() =>
      useMapPage({
        search: { issue_areas: "housing-affordability" },
        navigate: requireMapPageMocks().navigate,
      }),
    );
    expect(result.current.hasActiveFilters).toBe(true);
    act(() => {
      result.current.onClearFilters();
    });
    expect(requireMapPageMocks().navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: ".", search: { view: "map" } }),
    );
  });

  it("recenters on the country through the map camera", () => {
    const map = makeFakeMap({
      center: { lng: -74, lat: 40 },
      zoom: 9,
      bounds: { sw: { lng: -75, lat: 39 }, ne: { lng: -73, lat: 41 } },
    });
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate, map }),
    );
    act(() => {
      result.current.onZoomOut();
    });
    expect(map.flyTo).toHaveBeenCalledOnce();
  });

  it("seeds the points query with the server payload for the CONUS view", () => {
    const seeded = { points: [makePoint({ id: "seed" })], total: 1, capped: false };
    renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate, initialPoints: seeded }),
    );
    expect(readMapPageMocks().lastOptions()?.initialData).toBe(seeded);
  });

  it("still sets a place's filter and opens an actor before the map mounts", () => {
    // No map is set: the camera moves are safe no-ops, but the URL and panel
    // still update so the experience never stalls waiting on the canvas.
    const { result } = renderHook(() =>
      useMapPage({ search: {}, navigate: requireMapPageMocks().navigate }),
    );
    const place: PlaceMatch = {
      kind: "city",
      label: "Dallas, TX",
      anchor: { lng: -96.8, lat: 32.78 },
      stateCode: "TX",
      cityKey: "Dallas, TX",
    };
    act(() => {
      result.current.onSelectPlace(place);
      result.current.onSelectActor(makePoint({ id: "1", lng: -96.8, lat: 32.78 }));
      result.current.onZoomOut();
    });
    expect(result.current.selection?.kind).toBe("actor");
    expect(lastNavigateSearch(requireMapPageMocks().navigate)).toMatchObject({
      cities: "Dallas, TX",
    });
  });
});
