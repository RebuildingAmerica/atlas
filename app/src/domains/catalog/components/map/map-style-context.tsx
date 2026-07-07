import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { requireAbsoluteMapStyleUrl } from "@/domains/catalog/map/map-config";

interface MapStyleContextValue {
  setStyleUrl: (styleUrl: string) => void;
  styleUrl: string;
}

const MapStyleContext = createContext<MapStyleContextValue | null>(null);

export function MapStyleProvider({
  children,
  initialStyleUrl,
}: {
  children: ReactNode;
  initialStyleUrl: string;
}) {
  const [styleUrl, setValidatedStyleUrl] = useState(() =>
    requireAbsoluteMapStyleUrl(initialStyleUrl),
  );
  const value = useMemo<MapStyleContextValue>(
    () => ({
      setStyleUrl: (nextStyleUrl: string) => {
        setValidatedStyleUrl(requireAbsoluteMapStyleUrl(nextStyleUrl));
      },
      styleUrl,
    }),
    [styleUrl],
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
