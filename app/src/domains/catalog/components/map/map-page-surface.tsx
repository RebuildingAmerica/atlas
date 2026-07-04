import { lazy, Suspense } from "react";
import type { ComponentProps, Ref } from "react";
import type { MapInteractiveSurface } from "@/domains/catalog/components/map/map-interactive-surface";

const LazyMapInteractiveSurface = lazy(async () => {
  const module = await import("@/domains/catalog/components/map/map-interactive-surface");
  return { default: module.MapInteractiveSurface };
});

export type MapPageSurfaceProps = ComponentProps<typeof MapInteractiveSurface> & {
  /** Imperative focus target used after the detail panel closes. */
  surfaceRef?: Ref<HTMLDivElement>;
};

/** The quiet first paint while the WebGL chunk loads. */
function MapSurfaceFallback() {
  return <div className="bg-page-bg absolute inset-0" aria-hidden />;
}

/**
 * Full-bleed map surface shell.
 *
 * This owns page layout, focus restoration, and the lazy boundary, while the
 * imported interactive surface owns only MapLibre-specific rendering.
 */
export function MapPageSurface({ surfaceRef, ...surfaceProps }: MapPageSurfaceProps) {
  return (
    <div ref={surfaceRef} tabIndex={-1} className="absolute inset-0 outline-none">
      <Suspense fallback={<MapSurfaceFallback />}>
        <LazyMapInteractiveSurface {...surfaceProps} />
      </Suspense>
    </div>
  );
}
