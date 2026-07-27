// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MapInteractiveSurface } from "@/domains/catalog/components/map/map-interactive-surface";
import { MapStyleProvider } from "@/domains/catalog/components/map/map-style-context";
import { ATLAS_BASEMAP_STYLE } from "@/domains/catalog/map/map-config";
import { CONUS_VIEW } from "@rebuildingamerica/atlas-catalog/map/map-viewport";
import { selectActor } from "@rebuildingamerica/atlas-catalog/map/map-selection";
import { CONUS_BOUNDS, makePoint } from "../../../../../helpers/catalog/map-clustering-harness";
import { makeFakeMap } from "../../../../../helpers/catalog/fake-map";
import type { MockMapProps } from "../../../../../helpers/catalog/actor-map-surface-harness";
import type { MockMarkerProps } from "../../../../../helpers/catalog/marker-mock-harness";

const mapCapture = vi.hoisted(() => ({ props: null as MockMapProps | null }));

// The map CSS is a side-effect import with no JS surface; stub it so vitest
// (which has no Vite CSS pipeline) can load the module under test.
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

vi.mock("react-map-gl/maplibre", () => ({
  default: (props: MockMapProps) => {
    mapCapture.props = props;
    return (
      <div data-testid="maplibre-map" aria-label={props["aria-label"]}>
        {props.children}
      </div>
    );
  },
  Marker: (props: MockMarkerProps) => <div data-testid="marker">{props.children}</div>,
  useMap: () => ({ current: undefined }),
}));

afterEach(() => {
  cleanup();
  mapCapture.props = null;
});

describe("MapInteractiveSurface", () => {
  it("hands the mounted camera back to the shell and reports the first viewport", () => {
    const onLoad = vi.fn();
    const onMapReady = vi.fn();
    const camera = makeFakeMap({
      center: { lng: -96, lat: 38 },
      zoom: 4,
      bounds: { sw: { lng: -125, lat: 24 }, ne: { lng: -66.5, lat: 49.5 } },
    });

    render(
      <MapStyleProvider initialStyle={ATLAS_BASEMAP_STYLE}>
        <MapInteractiveSurface
          bounds={null}
          controlsRevealed
          initialView={CONUS_VIEW}
          onLoad={onLoad}
          onMapReady={onMapReady}
          onMoveEnd={vi.fn()}
          onSelectCluster={vi.fn()}
          onSelectPoint={vi.fn()}
          points={[]}
          reducedMotion={false}
          selection={null}
          zoom={4}
        />
      </MapStyleProvider>,
    );

    expect(screen.getByTestId("maplibre-map")).toBeInTheDocument();
    expect(mapCapture.props?.mapStyle).toBe(ATLAS_BASEMAP_STYLE);

    const loadEvent = { target: camera };
    mapCapture.props?.onLoad?.(loadEvent);

    expect(onMapReady).toHaveBeenCalledWith(camera);
    expect(onLoad).toHaveBeenCalledWith(loadEvent);
  });

  it("holds the marker layer back until the map reports where it is looking", () => {
    const { rerender } = render(
      <MapStyleProvider initialStyle={ATLAS_BASEMAP_STYLE}>
        <MapInteractiveSurface
          bounds={null}
          controlsRevealed
          initialView={CONUS_VIEW}
          onLoad={vi.fn()}
          onMapReady={vi.fn()}
          onMoveEnd={vi.fn()}
          onSelectCluster={vi.fn()}
          onSelectPoint={vi.fn()}
          points={[makePoint({ id: "a", lng: -122, lat: 37 })]}
          reducedMotion={false}
          selection={null}
          zoom={4}
        />
      </MapStyleProvider>,
    );

    expect(screen.queryAllByTestId("marker")).toHaveLength(0);

    rerender(
      <MapStyleProvider initialStyle={ATLAS_BASEMAP_STYLE}>
        <MapInteractiveSurface
          bounds={CONUS_BOUNDS}
          controlsRevealed
          initialView={CONUS_VIEW}
          onLoad={vi.fn()}
          onMapReady={vi.fn()}
          onMoveEnd={vi.fn()}
          onSelectCluster={vi.fn()}
          onSelectPoint={vi.fn()}
          points={[makePoint({ id: "a", lng: -122, lat: 37 })]}
          reducedMotion={false}
          selection={null}
          zoom={4}
        />
      </MapStyleProvider>,
    );

    expect(screen.getAllByTestId("marker")).toHaveLength(1);
  });

  it("marks the open actor as selected and opens another from its dot", () => {
    const point = makePoint({ id: "a", lng: -122, lat: 37, name: "River Keepers" });
    const onSelectPoint = vi.fn();

    render(
      <MapStyleProvider initialStyle={ATLAS_BASEMAP_STYLE}>
        <MapInteractiveSurface
          bounds={CONUS_BOUNDS}
          controlsRevealed
          initialView={CONUS_VIEW}
          onLoad={vi.fn()}
          onMapReady={vi.fn()}
          onMoveEnd={vi.fn()}
          onSelectCluster={vi.fn()}
          onSelectPoint={onSelectPoint}
          points={[point]}
          reducedMotion={false}
          selection={selectActor(point, { lng: -122, lat: 37 })}
          zoom={4}
        />
      </MapStyleProvider>,
    );

    const dot = screen.getByRole("button", { name: /River Keepers/ });
    expect(dot).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(dot);
    expect(onSelectPoint).toHaveBeenCalled();
  });

  it("keeps the camera controls invisible until the chrome reveal finishes", () => {
    const { container, rerender } = render(
      <MapStyleProvider initialStyle={ATLAS_BASEMAP_STYLE}>
        <MapInteractiveSurface
          bounds={CONUS_BOUNDS}
          controlsRevealed={false}
          initialView={CONUS_VIEW}
          onLoad={vi.fn()}
          onMapReady={vi.fn()}
          onMoveEnd={vi.fn()}
          onSelectCluster={vi.fn()}
          onSelectPoint={vi.fn()}
          points={[]}
          reducedMotion
          selection={null}
          zoom={4}
        />
      </MapStyleProvider>,
    );

    expect(container.querySelector(".opacity-0")).not.toBeNull();
    expect(container.querySelector(".opacity-100")).toBeNull();

    rerender(
      <MapStyleProvider initialStyle={ATLAS_BASEMAP_STYLE}>
        <MapInteractiveSurface
          bounds={CONUS_BOUNDS}
          controlsRevealed
          initialView={CONUS_VIEW}
          onLoad={vi.fn()}
          onMapReady={vi.fn()}
          onMoveEnd={vi.fn()}
          onSelectCluster={vi.fn()}
          onSelectPoint={vi.fn()}
          points={[]}
          reducedMotion
          selection={null}
          zoom={4}
        />
      </MapStyleProvider>,
    );

    expect(container.querySelector(".opacity-100")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
  });
});
