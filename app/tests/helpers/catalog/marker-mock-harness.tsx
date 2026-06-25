import type { ReactNode } from "react";

/** The `<Marker>` props the mocked map module hands a layer under test. */
export interface MockMarkerProps {
  longitude: number;
  latitude: number;
  children: ReactNode;
}

/** A captured `<Marker>` render: where it was anchored on the map. */
export interface CapturedMarker {
  longitude: number;
  latitude: number;
}

/** Records every `<Marker>` the layer rendered for later assertion. */
export interface MarkerCapture {
  markers: CapturedMarker[];
}

/** Build an empty marker capture so each test starts clean. */
export function createMarkerCapture(): MarkerCapture {
  return { markers: [] };
}
