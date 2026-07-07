import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { StyleSpecification } from "maplibre-gl";

interface MapStyleContextValue {
  setStyle: (style: StyleSpecification) => void;
  style: StyleSpecification;
}

const MapStyleContext = createContext<MapStyleContextValue | null>(null);

export function MapStyleProvider({
  children,
  initialStyle,
}: {
  children: ReactNode;
  initialStyle: StyleSpecification;
}) {
  const [style, setStyle] = useState<StyleSpecification>(initialStyle);
  const value = useMemo<MapStyleContextValue>(
    () => ({
      setStyle,
      style,
    }),
    [style],
  );

  return <MapStyleContext.Provider value={value}>{children}</MapStyleContext.Provider>;
}

export function useMapStyle(): MapStyleContextValue {
  const value = useContext(MapStyleContext);
  if (!value) {
    throw new Error("MapStyleProvider is required before reading the map style.");
  }

  return value;
}
