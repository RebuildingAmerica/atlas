import { useCallback } from "react";
import type { ComponentProps } from "react";
import { ActorMapSurface } from "@/domains/catalog/components/map/actor-map-surface";
import { MapControls } from "@/domains/catalog/components/map/map-controls";
import { MapMarkerLayer } from "@/domains/catalog/components/map/map-marker-layer";
import { useMapStyle } from "@/domains/catalog/components/map/map-style-context";
import { usePanelCamera } from "@/domains/catalog/hooks/use-panel-camera";
import type { FlyToCamera } from "@/domains/catalog/map/map-camera";
import type { MapSelection } from "@/domains/catalog/map/map-selection";
import type { MapView } from "@/domains/catalog/map/map-viewport";
import type { MapViewportEvent } from "@/domains/catalog/hooks/use-map-page";
import type { MapBounds, MapPoint } from "@rebuildingamerica/atlas-api-client";

/** The detail panel's width in pixels, used to inset the camera beside it. */
const PANEL_WIDTH_PX = 384;

interface MapCameraSyncProps {
  /** The current open map selection, if a detail panel is visible. */
  selection: MapSelection | null;
  /** Whether the visitor prefers reduced motion. */
  reducedMotion: boolean;
}

/**
 * Keep the open selection framed beside the panel.
 *
 * Lives inside the basemap chunk so the route shell can stay free of MapLibre.
 * It renders nothing; the only visible effect is that a selected dot stays in
 * view beside the detail panel instead of being covered by it.
 */
function MapCameraSync({ selection, reducedMotion }: MapCameraSyncProps) {
  usePanelCamera(selection, PANEL_WIDTH_PX, { reducedMotion });
  return null;
}

interface MapInteractiveSurfaceProps {
  /** The restored or default camera used when the basemap first mounts. */
  initialView: MapView;
  /** Actors currently fetched for the viewport. */
  points: MapPoint[];
  /** The best-known viewport bounds; seeded to the country until MapLibre reports live bounds. */
  bounds: MapBounds | null;
  /** The current map zoom, which drives client-side clustering. */
  zoom: number;
  /** The current open actor or cluster selection. */
  selection: MapSelection | null;
  /** Whether map camera movement should avoid animation. */
  reducedMotion: boolean;
  /** Whether the staged chrome reveal has finished. */
  controlsRevealed: boolean;
  /** Hand the mounted map camera back to the route shell. */
  onMapReady: (map: FlyToCamera) => void;
  /** Read the first viewport once the basemap loads. */
  onLoad: (event: MapViewportEvent) => void;
  /** Read viewport changes after pan and zoom settle. */
  onMoveEnd: (event: MapViewportEvent) => void;
  /** Open one actor's detail panel from a dot. */
  onSelectPoint: MapInteractivePointHandler;
  /** Open a cluster's member list from a count bubble. */
  onSelectCluster: MapInteractiveClusterHandler;
}

type MapInteractivePointHandler = ComponentProps<typeof MapMarkerLayer>["onSelectPoint"];
type MapInteractiveClusterHandler = ComponentProps<typeof MapMarkerLayer>["onSelectCluster"];

/**
 * The WebGL-backed part of the map page.
 *
 * This component owns every dependency that needs the mounted MapLibre context:
 * the basemap, marker layer, camera sync effect, and camera controls. The page
 * shell can render skip links, panels, and data states without evaluating this
 * chunk, which keeps non-canvas affordances available earlier.
 */
export function MapInteractiveSurface({
  initialView,
  points,
  bounds,
  zoom,
  selection,
  reducedMotion,
  controlsRevealed,
  onMapReady,
  onLoad,
  onMoveEnd,
  onSelectPoint,
  onSelectCluster,
}: MapInteractiveSurfaceProps) {
  const { style } = useMapStyle();
  const handleLoad = useCallback(
    (event: MapViewportEvent & { target: FlyToCamera }) => {
      onMapReady(event.target);
      onLoad(event);
    },
    [onLoad, onMapReady],
  );

  return (
    <ActorMapSurface
      mapStyle={style}
      initialView={initialView}
      onLoad={handleLoad}
      onMoveEnd={onMoveEnd}
    >
      <MapCameraSync selection={selection} reducedMotion={reducedMotion} />
      {bounds ? (
        <MapMarkerLayer
          points={points}
          bounds={bounds}
          zoom={zoom}
          selectedId={selection?.kind === "actor" ? selection.point.id : undefined}
          reducedMotion={reducedMotion}
          onSelectPoint={onSelectPoint}
          onSelectCluster={onSelectCluster}
        />
      ) : null}
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity ${
          controlsRevealed ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="absolute right-3 bottom-3 sm:right-4 sm:bottom-4">
          <MapControls reducedMotion={reducedMotion} />
        </div>
      </div>
    </ActorMapSurface>
  );
}
