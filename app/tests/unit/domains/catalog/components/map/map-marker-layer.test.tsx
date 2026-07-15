// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MapMarkerLayer } from "@/domains/catalog/components/map/map-marker-layer";
import type { SelectionAnchor } from "@/domains/catalog/map/map-selection";
import type { MapPoint } from "@rebuildingamerica/atlas-api-client";
import { CONUS_BOUNDS, makePoint } from "../../../../../helpers/catalog/map-clustering-harness";
import {
  type MarkerCapture,
  type MockMarkerProps,
  createMarkerCapture,
} from "../../../../../helpers/catalog/marker-mock-harness";

const capture = vi.hoisted<{ value: MarkerCapture }>(() => ({
  value: { markers: [] },
}));

vi.mock("react-map-gl/maplibre", () => ({
  Marker: (props: MockMarkerProps) => {
    capture.value.markers.push({ longitude: props.longitude, latitude: props.latitude });
    return <div data-testid="marker">{props.children}</div>;
  },
}));

afterEach(() => {
  cleanup();
  capture.value = createMarkerCapture();
});

describe("MapMarkerLayer", () => {
  it("places one marker per far-apart actor", () => {
    const points: MapPoint[] = [
      makePoint({ id: "a", lng: -122, lat: 37 }),
      makePoint({ id: "b", lng: -74, lat: 40 }),
    ];
    render(
      <MapMarkerLayer
        points={points}
        bounds={CONUS_BOUNDS}
        zoom={4}
        onSelectPoint={vi.fn()}
        onSelectCluster={vi.fn()}
      />,
    );
    expect(capture.value.markers).toHaveLength(2);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("renders a single cluster bubble for a crowd of co-located actors", () => {
    const points: MapPoint[] = Array.from({ length: 12 }, (_, i) =>
      makePoint({ id: `c${i}`, lng: -96.8, lat: 32.78 }),
    );
    render(
      <MapMarkerLayer
        points={points}
        bounds={CONUS_BOUNDS}
        zoom={4}
        onSelectPoint={vi.fn()}
        onSelectCluster={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /12 people and groups here/ })).toBeTruthy();
  });

  it("opens a cluster's crowd with every actor it holds when its bubble is clicked", () => {
    const onSelectCluster =
      vi.fn<(members: MapPoint[], anchor: SelectionAnchor, id: number) => void>();
    const points: MapPoint[] = Array.from({ length: 12 }, (_, i) =>
      makePoint({ id: `c${i}`, lng: -96.8, lat: 32.78 }),
    );
    render(
      <MapMarkerLayer
        points={points}
        bounds={CONUS_BOUNDS}
        zoom={4}
        onSelectPoint={vi.fn()}
        onSelectCluster={onSelectCluster}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /12 people and groups here/ }));
    expect(onSelectCluster).toHaveBeenCalledOnce();
    const call = onSelectCluster.mock.calls[0];
    expect(call?.[0]).toHaveLength(12);
    expect(typeof call?.[1].lng).toBe("number");
    expect(typeof call?.[1].lat).toBe("number");
    expect(typeof call?.[2]).toBe("number");
  });

  it("opens an actor's panel anchored at its rendered coordinate when its dot is clicked", () => {
    const onSelectPoint = vi.fn<(point: MapPoint, anchor: SelectionAnchor) => void>();
    const point = makePoint({ id: "solo", lng: -100, lat: 40 });
    render(
      <MapMarkerLayer
        points={[point]}
        bounds={CONUS_BOUNDS}
        zoom={6}
        onSelectPoint={onSelectPoint}
        onSelectCluster={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onSelectPoint).toHaveBeenCalledOnce();
    const call = onSelectPoint.mock.calls[0];
    expect(call?.[0]).toBe(point);
    expect(typeof call?.[1].lng).toBe("number");
    expect(typeof call?.[1].lat).toBe("number");
  });

  it("marks the selected actor's dot as pressed", () => {
    const point = makePoint({ id: "solo", lng: -100, lat: 40 });
    render(
      <MapMarkerLayer
        points={[point]}
        bounds={CONUS_BOUNDS}
        zoom={6}
        selectedId="solo"
        onSelectPoint={vi.fn()}
        onSelectCluster={vi.fn()}
      />,
    );
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });
});
