import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { MapSelection } from "@rebuildingamerica/atlas-catalog/map/map-selection";

/** How long the camera takes to glide the selection beside the panel, in ms. */
export const PANEL_CAMERA_DURATION_MS = 240;

interface PanelCameraOptions {
  /** Jump rather than glide for visitors who prefer reduced motion. */
  reducedMotion?: boolean;
}

/**
 * Keep the open selection visible beside the detail panel.
 *
 * When an actor or cluster opens, the panel slides in over the right edge of
 * the map; left unmanaged it would cover the very marker a visitor just
 * clicked. This eases the camera so the selection's anchor sits in the
 * still-visible left portion, passing `padding.right` equal to the panel's
 * width so MapLibre frames the point against the reduced canvas. The ease runs
 * for the same beat as the panel's slide so the two read as one gesture; a
 * reduced-motion visitor gets an instant cut instead.
 *
 * The effect re-runs whenever the selection or its anchor changes, so stepping
 * from one cluster member to the next re-frames each in turn. Nothing happens
 * while the panel is closed or before the map has mounted.
 *
 * @param selection The open selection, or `null` when the panel is closed.
 * @param panelWidth The panel's width in pixels, used as the right padding.
 * @param options Motion preferences.
 */
export function usePanelCamera(
  selection: MapSelection | null,
  panelWidth: number,
  options?: PanelCameraOptions,
): void {
  const map = useMap().current;
  const reducedMotion = options?.reducedMotion ?? false;
  const lng = selection?.anchor.lng;
  const lat = selection?.anchor.lat;

  useEffect(() => {
    if (!map || lng === undefined || lat === undefined) {
      return;
    }
    map.easeTo({
      center: [lng, lat],
      padding: { top: 0, bottom: 0, left: 0, right: panelWidth },
      duration: reducedMotion ? 0 : PANEL_CAMERA_DURATION_MS,
    });
  }, [map, lng, lat, panelWidth, reducedMotion]);
}
