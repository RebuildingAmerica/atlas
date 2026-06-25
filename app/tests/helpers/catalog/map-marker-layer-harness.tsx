import type { ReactNode } from "react";

/** The `<Marker>` props the mocked map module hands the layer under test. */
export interface MockMarkerProps {
  longitude: number;
  latitude: number;
  children: ReactNode;
}

/** A captured `<Marker>` render: its anchor coordinates and its child content. */
export interface CapturedMarker {
  longitude: number;
  latitude: number;
  children: ReactNode;
}

/** A captured `easeTo` invocation from the marker layer's cluster bloom. */
export interface EaseToCall {
  center: [number, number];
  zoom: number;
  duration: number;
}

/** The minimal camera surface the marker layer drives for cluster expansion. */
export interface MockMapInstance {
  easeTo: (options: EaseToCall) => void;
}

/** Shared mutable capture for the mocked map module across a test file. */
export interface MarkerLayerCapture {
  markers: CapturedMarker[];
  map: MockMapInstance | null;
  easeToCalls: EaseToCall[];
}

/** Build a fresh capture object so each test starts from a clean slate. */
export function createMarkerLayerCapture(): MarkerLayerCapture {
  return { markers: [], map: null, easeToCalls: [] };
}

/**
 * Install a fake map into the capture whose `easeTo` records its calls, so a
 * test can assert the layer drove the camera (cluster bloom) without a real
 * WebGL map.
 */
export function installMockMap(capture: MarkerLayerCapture): MockMapInstance {
  const map: MockMapInstance = {
    easeTo: (options) => {
      capture.easeToCalls.push(options);
    },
  };
  capture.map = map;
  return map;
}
