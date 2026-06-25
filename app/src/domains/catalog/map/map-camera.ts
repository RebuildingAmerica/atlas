import type { SelectionAnchor } from "@/domains/catalog/map/map-selection";

/** How long the gentle parabolic fly-to arc runs, in milliseconds. */
export const FLY_TO_DURATION_MS = 900;

/**
 * The curvature of the fly-to arc.
 *
 * Below MapLibre's default (~1.42) the camera rises less steeply, so flying to
 * a searched place reads as a calm glide across the country rather than a
 * dramatic zoom-out-and-back.
 */
const FLY_TO_CURVE = 1.2;

/** Options accepted by MapLibre's `flyTo`, narrowed to what the arc needs. */
interface FlyToOptions {
  center: [number, number];
  zoom: number;
  duration: number;
  curve: number;
  essential: boolean;
}

/** Options accepted by MapLibre's `jumpTo`, narrowed to the reduced-motion cut. */
interface JumpToOptions {
  center: [number, number];
  zoom: number;
}

/** The minimal camera surface a place fly-to drives. */
export interface FlyToCamera {
  flyTo: (options: FlyToOptions) => void;
  jumpTo: (options: JumpToOptions) => void;
}

interface FlyToPlaceOptions {
  /** Cut straight to the destination instead of arcing, for reduced motion. */
  reducedMotion?: boolean;
}

/**
 * Glide the camera to a searched place along a gentle arc.
 *
 * When a visitor picks a city or state from the command bar the map sweeps
 * there rather than teleporting, so the act of searching keeps them oriented in
 * the same continuous space. `essential: true` keeps the animation honored even
 * under the browser's own reduced-motion media setting, because here the
 * movement *is* the answer to the search — so for visitors who prefer reduced
 * motion we cut straight to the destination instead. Nothing happens before the
 * map has mounted.
 *
 * @param map The map's camera, or `null` before it mounts.
 * @param anchor The destination longitude/latitude.
 * @param zoom The zoom to settle at.
 * @param options Motion preferences.
 */
export function flyToPlace(
  map: FlyToCamera | null,
  anchor: SelectionAnchor,
  zoom: number,
  options?: FlyToPlaceOptions,
): void {
  if (!map) {
    return;
  }
  const center: [number, number] = [anchor.lng, anchor.lat];
  if (options?.reducedMotion) {
    map.jumpTo({ center, zoom });
    return;
  }
  map.flyTo({ center, zoom, duration: FLY_TO_DURATION_MS, curve: FLY_TO_CURVE, essential: true });
}
