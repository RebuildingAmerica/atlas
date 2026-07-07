// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ActorMapSurface } from "@/domains/catalog/components/map/actor-map-surface";
import { ATLAS_BASEMAP_STYLE } from "@/domains/catalog/map/map-config";
import type { MockMapProps } from "../../../../../helpers/catalog/actor-map-surface-harness";

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
}));

afterEach(() => {
  cleanup();
  mapCapture.props = null;
});

describe("ActorMapSurface", () => {
  it("renders a flat, north-up basemap framed on the continental US", () => {
    render(<ActorMapSurface mapStyle={ATLAS_BASEMAP_STYLE} />);

    expect(screen.getByLabelText("Map of people and groups across the United States")).toBeTruthy();
    const props = mapCapture.props;
    expect(props).not.toBeNull();
    expect(props?.initialViewState.bounds).toEqual([
      [-125, 24],
      [-66.5, 49.5],
    ]);
    expect(props?.initialViewState.fitBoundsOptions?.padding).toBe(24);
    // Rotation and pitch are off so the nation always reads like a printed atlas.
    expect(props?.dragRotate).toBe(false);
    expect(props?.pitchWithRotate).toBe(false);
    expect(props?.touchPitch).toBe(false);
    expect(props?.maxPitch).toBe(0);
  });

  it("threads the Atlas basemap style into the map", () => {
    render(<ActorMapSurface mapStyle={ATLAS_BASEMAP_STYLE} />);
    expect(mapCapture.props?.mapStyle).toBe(ATLAS_BASEMAP_STYLE);
  });

  it("composes overlay chrome in as children", () => {
    render(
      <ActorMapSurface mapStyle={ATLAS_BASEMAP_STYLE}>
        <div data-testid="overlay-chrome">legend</div>
      </ActorMapSurface>,
    );
    expect(screen.getByTestId("overlay-chrome")).toBeTruthy();
  });

  it("opens at a restored center and zoom when one is supplied", () => {
    render(
      <ActorMapSurface
        mapStyle={ATLAS_BASEMAP_STYLE}
        initialView={{ center: { lng: -96.8, lat: 32.78 }, zoom: 9 }}
      />,
    );
    expect(mapCapture.props?.initialViewState.longitude).toBe(-96.8);
    expect(mapCapture.props?.initialViewState.latitude).toBe(32.78);
    expect(mapCapture.props?.initialViewState.zoom).toBe(9);
    expect(mapCapture.props?.initialViewState.bounds).toBeUndefined();
  });

  it("forwards the load and move-end handlers to the map", () => {
    const onLoad = vi.fn();
    const onMoveEnd = vi.fn();
    render(
      <ActorMapSurface mapStyle={ATLAS_BASEMAP_STYLE} onLoad={onLoad} onMoveEnd={onMoveEnd} />,
    );
    expect(mapCapture.props?.onLoad).toBe(onLoad);
    expect(mapCapture.props?.onMoveEnd).toBe(onMoveEnd);
  });
});
