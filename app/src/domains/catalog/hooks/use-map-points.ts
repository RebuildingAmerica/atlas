import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { MapBounds, MapPointCollection, MapPointParams } from "@/types";

/** How long a viewport must hold still before we refetch its actors. */
export const MAP_POINTS_DEBOUNCE_MS = 300;

/**
 * Decimal places the bounding box is rounded to for the query key.
 *
 * ~0.01° is roughly a kilometer, far finer than any visible re-cluster, so
 * sub-pixel pans collapse onto the same cached key instead of stampeding the
 * endpoint while a person nudges the map.
 */
const BBOX_KEY_PRECISION = 2;

function roundCoordinate(value: number): number {
  const factor = 10 ** BBOX_KEY_PRECISION;
  return Math.round(value * factor) / factor;
}

/** Round a bounding box to the cache-key grid so micro-pans reuse one query. */
export function roundBounds(bounds: MapBounds): MapBounds {
  return {
    minLng: roundCoordinate(bounds.minLng),
    minLat: roundCoordinate(bounds.minLat),
    maxLng: roundCoordinate(bounds.maxLng),
    maxLat: roundCoordinate(bounds.maxLat),
  };
}

/**
 * Build the React Query key for a viewport query.
 *
 * The bounding box is rounded so trivially different viewports share a cache
 * entry; the facet filters are passed through verbatim so the map and the
 * browse list stay in lockstep.
 */
export function mapPointsQueryKey(params: MapPointParams) {
  const { bounds, ...filters } = params;
  return ["map-points", roundBounds(bounds), filters] as const;
}

interface UseMapPointsOptions {
  /** Hydrate the cache with a server-seeded payload so the first paint has data. */
  initialData?: MapPointCollection;
  /** Pause fetching (e.g. before the map has reported its first viewport). */
  enabled?: boolean;
}

/**
 * Debounce the viewport so a fling or pinch resolves to a single fetch.
 *
 * The returned params lag the live params by {@link MAP_POINTS_DEBOUNCE_MS};
 * `null` is passed straight through so a disabled hook never schedules a timer.
 */
function useDebouncedMapPointParams(params: MapPointParams | null): MapPointParams | null {
  const [debounced, setDebounced] = useState<MapPointParams | null>(params);

  useEffect(() => {
    if (params === null) {
      setDebounced(null);
      return;
    }
    const handle = window.setTimeout(() => {
      setDebounced(params);
    }, MAP_POINTS_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [params]);

  return debounced;
}

/**
 * Fetch placed people and groups inside the current viewport.
 *
 * Debounces the viewport (so panning feels buttery, not chattery), keys the
 * cache on a rounded bounding box plus the browse facet filters, and keeps the
 * previous page of dots on screen while the next one loads so the map never
 * blinks empty during a pan.
 */
export function useMapPoints(params: MapPointParams | null, options?: UseMapPointsOptions) {
  const debouncedParams = useDebouncedMapPointParams(params);
  const enabled = (options?.enabled ?? true) && debouncedParams !== null;

  return useQuery<MapPointCollection>({
    queryKey: debouncedParams ? mapPointsQueryKey(debouncedParams) : ["map-points", "idle"],
    queryFn: () => {
      if (debouncedParams === null) {
        // `enabled` gates this query off whenever the viewport is unknown, so a
        // null here means the guard upstream broke — surface it loudly rather
        // than silently substituting an empty viewport.
        throw new Error("useMapPoints query ran without a known viewport.");
      }
      return api.entries.mapPoints(debouncedParams);
    },
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
    enabled,
    initialData: options?.initialData,
  });
}
