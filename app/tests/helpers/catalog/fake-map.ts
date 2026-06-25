import { type Mock, vi } from "vitest";
import type { SelectionAnchor } from "@/domains/catalog/map/map-selection";
import type { ReadableMap } from "@/domains/catalog/map/map-readout";

/** A south-west / north-east corner pair, as MapLibre's bounds expose them. */
export interface FakeBoundsConfig {
  sw: SelectionAnchor;
  ne: SelectionAnchor;
}

/** The camera + bounds a fake map should report. */
export interface FakeMapConfig {
  center: SelectionAnchor;
  zoom: number;
  bounds: FakeBoundsConfig;
}

/** The camera options a fly/jump/ease command captures, narrowed for assertions. */
export interface CapturedCameraOptions {
  center: [number, number];
  zoom: number;
  duration?: number;
  curve?: number;
  essential?: boolean;
  padding?: { top: number; bottom: number; left: number; right: number };
}

/** A typed spy for one MapLibre camera command. */
export type CameraSpy = Mock<(options: CapturedCameraOptions) => void>;

/** A fake map exposing the read surface plus spies for the camera commands. */
export interface FakeMap extends ReadableMap {
  flyTo: CameraSpy;
  jumpTo: CameraSpy;
  easeTo: CameraSpy;
  zoomIn: Mock<() => void>;
  zoomOut: Mock<() => void>;
}

/**
 * Build a fake MapLibre map for component and hook tests.
 *
 * Reports a fixed camera and bounding box through the same `getCenter` /
 * `getZoom` / `getBounds` surface MapLibre exposes, and records every camera
 * command (`flyTo`, `easeTo`, `zoomIn`, …) so a test can assert the map was
 * driven without a real WebGL context.
 *
 * @param config The camera and bounds the fake map should report.
 * @returns The fake map.
 */
export function makeFakeMap(config: FakeMapConfig): FakeMap {
  return {
    getCenter: () => config.center,
    getZoom: () => config.zoom,
    getBounds: () => ({
      getSouthWest: () => config.bounds.sw,
      getNorthEast: () => config.bounds.ne,
    }),
    flyTo: vi.fn(),
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  };
}
