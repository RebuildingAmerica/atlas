import type { ReactNode } from "react";

/** The subset of react-map-gl `<Map>` props the surface test asserts on. */
export interface MockMapProps {
  mapStyle: string;
  initialViewState: { bounds: unknown; fitBoundsOptions: { padding: number } };
  dragRotate: boolean;
  pitchWithRotate: boolean;
  touchPitch: boolean;
  maxPitch: number;
  attributionControl: boolean;
  minZoom: number;
  maxZoom: number;
  "aria-label": string;
  children?: ReactNode;
}
