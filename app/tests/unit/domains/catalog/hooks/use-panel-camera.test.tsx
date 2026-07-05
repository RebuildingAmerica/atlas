// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { PANEL_CAMERA_DURATION_MS, usePanelCamera } from "@/domains/catalog/hooks/use-panel-camera";
import { selectActor, selectCluster } from "@/domains/catalog/map/map-selection";
import { makePoint } from "../../../../helpers/catalog/map-clustering-harness";
import {
  createPanelCameraControl,
  installPanelCameraMap,
} from "../../../../helpers/catalog/panel-camera-harness";

const control = vi.hoisted<{ value: ReturnType<typeof createPanelCameraControl> }>(() => {
  return { value: { map: null, calls: [] } };
});

vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({ current: control.value.map }),
}));

beforeEach(() => {
  control.value = createPanelCameraControl();
});

afterEach(cleanup);

describe("usePanelCamera", () => {
  it("eases the selected actor into view beside the panel", () => {
    installPanelCameraMap(control.value);
    const actor = selectActor(makePoint({ id: "a" }), { lng: -96.8, lat: 32.78 });
    renderHook(() => {
      usePanelCamera(actor, 360);
    });
    expect(control.value.calls).toHaveLength(1);
    expect(control.value.calls[0]?.center).toEqual([-96.8, 32.78]);
    expect(control.value.calls[0]?.padding.right).toBe(360);
    expect(control.value.calls[0]?.duration).toBe(PANEL_CAMERA_DURATION_MS);
  });

  it("frames a cluster's anchor when its crowd opens", () => {
    installPanelCameraMap(control.value);
    const cluster = selectCluster([makePoint({ id: "a" })], { lng: -100, lat: 40 }, 3);
    renderHook(() => {
      usePanelCamera(cluster, 360);
    });
    expect(control.value.calls[0]?.center).toEqual([-100, 40]);
  });

  it("does nothing when no panel is open", () => {
    installPanelCameraMap(control.value);
    renderHook(() => {
      usePanelCamera(null, 360);
    });
    expect(control.value.calls).toHaveLength(0);
  });

  it("never reaches for a camera that has not mounted yet", () => {
    const actor = selectActor(makePoint({ id: "a" }), { lng: -96.8, lat: 32.78 });
    expect(() => {
      renderHook(() => {
        usePanelCamera(actor, 360);
      });
    }).not.toThrow();
    expect(control.value.calls).toHaveLength(0);
  });

  it("jumps instead of gliding for reduced-motion visitors", () => {
    installPanelCameraMap(control.value);
    const actor = selectActor(makePoint({ id: "a" }), { lng: -96.8, lat: 32.78 });
    renderHook(() => {
      usePanelCamera(actor, 360, { reducedMotion: true });
    });
    expect(control.value.calls[0]?.duration).toBe(0);
  });

  it("re-frames when the selection changes to a new actor", () => {
    installPanelCameraMap(control.value);
    const first = selectActor(makePoint({ id: "a" }), { lng: -96.8, lat: 32.78 });
    const { rerender } = renderHook(
      ({ selection }) => {
        usePanelCamera(selection, 360);
      },
      {
        initialProps: { selection: first },
      },
    );
    expect(control.value.calls).toHaveLength(1);
    const second = selectActor(makePoint({ id: "b" }), { lng: -74, lat: 40.7 });
    rerender({ selection: second });
    expect(control.value.calls).toHaveLength(2);
    expect(control.value.calls[1]?.center).toEqual([-74, 40.7]);
  });
});
