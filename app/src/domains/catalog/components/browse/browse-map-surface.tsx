import { lazy, Suspense } from "react";
import { GridSurface } from "@/domains/catalog/components/browse/browse-page-sections";
import type { BrowseSurfaceState } from "@/domains/catalog/components/browse/browse-page-sections";

const LazyUsMapSurface = lazy(async () => {
  const module = await import("@/domains/catalog/components/browse/us-map-surface");
  return { default: module.UsMapSurface };
});

interface BrowseMapSurfaceProps {
  onSelectState: (state: string) => void;
  selectedState?: string;
  stateDensity: BrowseSurfaceState[];
}

export function BrowseMapSurface({
  onSelectState,
  selectedState,
  stateDensity,
}: BrowseMapSurfaceProps) {
  return (
    <Suspense
      fallback={
        <GridSurface
          states={stateDensity}
          selectedState={selectedState}
          onSelectState={onSelectState}
        />
      }
    >
      <LazyUsMapSurface
        stateDensity={stateDensity}
        selectedState={selectedState}
        onSelectState={onSelectState}
      />
    </Suspense>
  );
}
