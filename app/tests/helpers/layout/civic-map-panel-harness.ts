import type { ReactNode } from "react";

export interface MockStateGeometry {
  id: string;
  properties: {
    name: string;
  };
}

export interface MockStateTopology {
  objects: {
    states: {
      geometries: MockStateGeometry[];
    };
  };
}

export interface MockGeography {
  id: string;
  properties: {
    name: string;
  };
  rsmKey: string;
}

export interface MockComposableMapProps {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  height?: number;
  projection?: string;
  width?: number;
}

export interface MockGeographiesProps {
  children: (input: { geographies: MockGeography[] }) => ReactNode;
  geography: MockStateTopology;
}

export interface MockGeographyProps {
  "aria-label"?: string;
  geography: MockGeography;
}

export interface MockMarkerProps {
  children: ReactNode;
  coordinates?: [number, number];
}
