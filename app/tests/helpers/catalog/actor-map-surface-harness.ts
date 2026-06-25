import type { ReactNode } from "react";

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
  mapStyle: string;
  initialViewState: MockInitialViewState;
  dragRotate: boolean;
  pitchWithRotate: boolean;
  touchPitch: boolean;
  maxPitch: number;
  attributionControl: boolean;
  minZoom: number;
  maxZoom: number;
  onLoad?: () => void;
  onMoveEnd?: () => void;
  "aria-label": string;
  children?: ReactNode;
}
