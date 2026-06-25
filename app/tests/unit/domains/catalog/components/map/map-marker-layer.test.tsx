// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MapMarkerLayer } from "@/domains/catalog/components/map/map-marker-layer";
import type { MapPoint } from "@/types";
import {
  createMarkerLayerCapture,
  installMockMap,
  type MarkerLayerCapture,
  type MockMarkerProps,
} from "../../../../../helpers/catalog/map-marker-layer-harness";
import { CONUS_BOUNDS, makePoint } from "../../../../../helpers/catalog/map-clustering-harness";

const capture = vi.hoisted((): { value: MarkerLayerCapture } => ({
  value: { markers: [], map: null, easeToCalls: [] },
}));

vi.mock("react-map-gl/maplibre", () => ({
  Marker: (props: MockMarkerProps) => {
    capture.value.markers.push({
      longitude: props.longitude,
      latitude: props.latitude,
      children: props.children,
    });
    return <div data-testid="marker">{props.children}</div>;
  },
  useMap: () => ({ current: capture.value.map }),
}));

afterEach(() => {
  cleanup();
  capture.value = createMarkerLayerCapture();
});

describe("MapMarkerLayer", () => {
  it("places one marker per far-apart actor", () => {
    installMockMap(capture.value);
    const points: MapPoint[] = [
      makePoint({ id: "a", lng: -122, lat: 37 }),
      makePoint({ id: "b", lng: -74, lat: 40 }),
    ];
    render(
      <MapMarkerLayer points={points} bounds={CONUS_BOUNDS} zoom={4} onSelectPoint={vi.fn()} />,
    );
    expect(capture.value.markers).toHaveLength(2);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("renders a single cluster bubble for a crowd of co-located actors", () => {
    installMockMap(capture.value);
    const points: MapPoint[] = Array.from({ length: 12 }, (_, i) =>
      makePoint({ id: `c${i}`, lng: -96.8, lat: 32.78 }),
    );
    render(
      <MapMarkerLayer points={points} bounds={CONUS_BOUNDS} zoom={4} onSelectPoint={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /12 civic actors here/ })).toBeTruthy();
  });

  it("eases toward a cluster's expansion zoom when its bubble is clicked", () => {
    installMockMap(capture.value);
    const points: MapPoint[] = Array.from({ length: 12 }, (_, i) =>
      makePoint({ id: `c${i}`, lng: -96.8, lat: 32.78 }),
    );
    render(
      <MapMarkerLayer points={points} bounds={CONUS_BOUNDS} zoom={4} onSelectPoint={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /12 civic actors here/ }));
    expect(capture.value.easeToCalls).toHaveLength(1);
    expect(capture.value.easeToCalls[0]?.zoom).toBeGreaterThan(4);
  });

  it("opens an actor's panel when its dot is clicked", () => {
    installMockMap(capture.value);
    const onSelectPoint = vi.fn();
    const point = makePoint({ id: "solo", lng: -100, lat: 40 });
    render(
      <MapMarkerLayer
        points={[point]}
        bounds={CONUS_BOUNDS}
        zoom={6}
        onSelectPoint={onSelectPoint}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onSelectPoint).toHaveBeenCalledWith(point);
  });

  it("marks the selected actor's dot as pressed", () => {
    installMockMap(capture.value);
    const point = makePoint({ id: "solo", lng: -100, lat: 40 });
    render(
      <MapMarkerLayer
        points={[point]}
        bounds={CONUS_BOUNDS}
        zoom={6}
        selectedId="solo"
        onSelectPoint={vi.fn()}
      />,
    );
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("never crashes when the map ref is not ready and a cluster is clicked", () => {
    capture.value.map = null;
    const points: MapPoint[] = Array.from({ length: 12 }, (_, i) =>
      makePoint({ id: `c${i}`, lng: -96.8, lat: 32.78 }),
    );
    render(
      <MapMarkerLayer points={points} bounds={CONUS_BOUNDS} zoom={4} onSelectPoint={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /12 civic actors here/ }));
    expect(capture.value.easeToCalls).toHaveLength(0);
  });
});
