import type { ReactNode } from "react";
import type { DragPanOptions, StyleSpecification } from "maplibre-gl";
import type { ReadableMap } from "@rebuildingamerica/atlas-catalog/map/map-readout";

/**
 * The camera event MapLibre replays to `onLoad` / `onMoveEnd`.
 *
 * Only `target` matters to the surfaces under test: they read the mounted
 * camera off it to report the first viewport.
 */
export interface MockMapCameraEvent {
  target: ReadableMap;
}

/** The view-state shape the mocked map records, covering both framings. */
export interface MockInitialViewState {
  bounds?: unknown;
  fitBoundsOptions?: { padding: number };
  longitude?: number;
  latitude?: number;
  zoom?: number;
}

/** The subset of react-map-gl `<Map>` props the surface test asserts on. */
export interface MockMapProps {
  mapStyle: StyleSpecification;
  initialViewState: MockInitialViewState;
  dragPan: DragPanOptions;
  dragRotate: boolean;
  pitchWithRotate: boolean;
  touchPitch: boolean;
  maxPitch: number;
  attributionControl: boolean;
  minZoom: number;
  maxZoom: number;
  workerUrl: string;
  onLoad?: (event: MockMapCameraEvent) => void;
  onMoveEnd?: (event: MockMapCameraEvent) => void;
  "aria-label": string;
  children?: ReactNode;
}
