// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MapControls } from "@/domains/catalog/components/map/map-controls";
import { CONUS_VIEW } from "@/domains/catalog/map/map-viewport";
import { makeFakeMap } from "../../../../../helpers/catalog/fake-map";
import { createMapControl } from "../../../../../helpers/catalog/map-control-harness";

const control = vi.hoisted(() => ({ value: { map: null } as ReturnType<typeof createMapControl> }));

vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({ current: control.value.map }),
}));

beforeEach(() => {
  control.value = createMapControl();
});

afterEach(cleanup);

describe("MapControls", () => {
  it("zooms the map in and out through MapLibre", () => {
    control.value.map = makeFakeMap({
      center: { lng: -96, lat: 38 },
      zoom: 4,
      bounds: { sw: { lng: -125, lat: 24 }, ne: { lng: -66.5, lat: 49.5 } },
    });
    render(<MapControls />);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(control.value.map.zoomIn).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(control.value.map.zoomOut).toHaveBeenCalledOnce();
  });

  it("recenters on the whole country with a gentle glide", () => {
    control.value.map = makeFakeMap({
      center: { lng: -74, lat: 40 },
      zoom: 9,
      bounds: { sw: { lng: -75, lat: 39 }, ne: { lng: -73, lat: 41 } },
    });
    render(<MapControls />);

    fireEvent.click(screen.getByRole("button", { name: "Recenter on the United States" }));
    expect(control.value.map.flyTo).toHaveBeenCalledOnce();
    const options = control.value.map.flyTo.mock.calls[0]?.[0];
    expect(options?.center).toEqual([CONUS_VIEW.center.lng, CONUS_VIEW.center.lat]);
    expect(options?.zoom).toBe(CONUS_VIEW.zoom);
  });

  it("jumps home instead of gliding for reduced-motion visitors", () => {
    control.value.map = makeFakeMap({
      center: { lng: -74, lat: 40 },
      zoom: 9,
      bounds: { sw: { lng: -75, lat: 39 }, ne: { lng: -73, lat: 41 } },
    });
    render(<MapControls reducedMotion />);

    fireEvent.click(screen.getByRole("button", { name: "Recenter on the United States" }));
    expect(control.value.map.jumpTo).toHaveBeenCalledOnce();
    expect(control.value.map.flyTo).not.toHaveBeenCalled();
  });

  it("does nothing before the map mounts", () => {
    render(<MapControls />);
    // No map yet: clicking the controls is a safe no-op rather than a crash.
    expect(() => {
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
      fireEvent.click(screen.getByRole("button", { name: "Recenter on the United States" }));
    }).not.toThrow();
  });
});
