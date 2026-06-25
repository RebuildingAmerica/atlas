import "maplibre-gl/dist/maplibre-gl.css";

import { useMemo } from "react";
import Map from "react-map-gl/maplibre";
import type { MapEvent, ViewStateChangeEvent } from "react-map-gl/maplibre";
import type { LngLatBoundsLike } from "maplibre-gl";
import { getMapStyleUrl } from "@/domains/catalog/map/map-config";
import type { MapView } from "@/domains/catalog/map/map-viewport";

/**
 * The continental US framing the map opens on.
 *
 * Lower-left and upper-right corners of a box that comfortably contains the
 * lower 48 with a little breathing room, so first paint lands on "America,"
 * not the middle of the Pacific.
 */
const CONUS_BOUNDS: LngLatBoundsLike = [
  [-125, 24],
  [-66.5, 49.5],
];

/** A touch of inset so the framed nation never kisses the chrome edges. */
const CONUS_FIT_PADDING = 24;

/** Keep the camera over the populated 48 without letting people fly off the planet. */
const MIN_MAP_ZOOM = 2.5;
const MAX_MAP_ZOOM = 16;

interface ActorMapSurfaceProps {
  /** Environment override for the basemap style URL; defaults to Vite's env. */
  styleUrlEnv?: Parameters<typeof getMapStyleUrl>[0];
  /**
   * A restored camera to open at — a center and zoom from a shared URL. When
   * omitted the map fits the continental-US bounds instead.
   */
  initialView?: MapView;
  /** Called once the basemap has finished loading, with the map event. */
  onLoad?: (event: MapEvent) => void;
  /** Called after a pan or zoom settles, with the view-state change event. */
  onMoveEnd?: (event: ViewStateChangeEvent) => void;
  /** Optional dot markers, clusters, and chrome rendered over the basemap. */
  children?: React.ReactNode;
}

/**
 * The Atlas basemap — a full-bleed MapLibre vector map framed on the continental
 * US, with rotation and pitch turned off so the country always reads flat and
 * north-up like a printed atlas. This component owns only the basemap and its
 * camera; civic-dot markers, clusters, and chrome compose in as children.
 *
 * The warm-paper canvas sits behind the canvas element so the page stays
 * continuous and inviting in the instant before tiles arrive, rather than
 * flashing the browser's default white.
 */
export function ActorMapSurface({
  styleUrlEnv,
  initialView,
  onLoad,
  onMoveEnd,
  children,
}: ActorMapSurfaceProps) {
  const mapStyle = useMemo(() => getMapStyleUrl(styleUrlEnv), [styleUrlEnv]);
  const initialViewState = initialView
    ? {
        longitude: initialView.center.lng,
        latitude: initialView.center.lat,
        zoom: initialView.zoom,
      }
    : { bounds: CONUS_BOUNDS, fitBoundsOptions: { padding: CONUS_FIT_PADDING } };

  return (
    <div className="bg-page-bg absolute inset-0">
      <Map
        mapStyle={mapStyle}
        initialViewState={initialViewState}
        minZoom={MIN_MAP_ZOOM}
        maxZoom={MAX_MAP_ZOOM}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        maxPitch={0}
        attributionControl={false}
        onLoad={onLoad}
        onMoveEnd={onMoveEnd}
        style={{ position: "absolute", inset: 0 }}
        aria-label="Map of civic actors across the United States"
      >
        {children}
      </Map>
    </div>
  );
}
