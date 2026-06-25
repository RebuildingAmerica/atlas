import { useCallback, useMemo } from "react";
import { Marker, useMap } from "react-map-gl/maplibre";
import type { MapBounds, MapPoint } from "@/types";
import { buildClusterIndex, deriveMapFeatures } from "@/domains/catalog/map/map-clustering";
import { CivicDotMarker } from "./civic-dot-marker";
import { ClusterBubble } from "./cluster-bubble";

/** How long the cluster-bloom ease runs when a bubble is clicked, in ms. */
const CLUSTER_BLOOM_MS = 500;

interface MapMarkerLayerProps {
  /** The placed actors currently fetched for the viewport. */
  points: MapPoint[];
  /** The viewport bounding box driving which features are derived. */
  bounds: MapBounds;
  /** The current map zoom, which decides what merges into a cluster. */
  zoom: number;
  /** The id of the actor whose panel is open, so its dot can read as selected. */
  selectedId?: string;
  /** Open an actor's detail panel. */
  onSelectPoint: (point: MapPoint) => void;
  /** Skip marker/cluster reveal motion for reduced-motion visitors. */
  reducedMotion?: boolean;
}

/**
 * The live layer of civic dots and count bubbles drawn over the basemap.
 *
 * It clusters the viewport's actors client-side (so a pan re-clusters with no
 * round trip), renders each derived feature as a focusable marker, and — when a
 * count bubble is clicked — gently blooms the camera to the zoom at which that
 * cluster breaks apart, turning "there are twelve here" into "here they are."
 */
export function MapMarkerLayer({
  points,
  bounds,
  zoom,
  selectedId,
  onSelectPoint,
  reducedMotion = false,
}: MapMarkerLayerProps) {
  const map = useMap().current;
  const index = useMemo(() => buildClusterIndex(points), [points]);
  const features = useMemo(() => deriveMapFeatures(index, bounds, zoom), [index, bounds, zoom]);

  const expandCluster = useCallback(
    (clusterId: number, lng: number, lat: number) => {
      if (!map) {
        return;
      }
      const expansionZoom = index.getClusterExpansionZoom(clusterId);
      map.easeTo({ center: [lng, lat], zoom: expansionZoom, duration: CLUSTER_BLOOM_MS });
    },
    [map, index],
  );

  return (
    <>
      {features.map((feature) => {
        if (feature.kind === "cluster") {
          return (
            <Marker
              key={`cluster-${feature.clusterId}`}
              longitude={feature.lng}
              latitude={feature.lat}
            >
              <ClusterBubble
                pointCount={feature.pointCount}
                reducedMotion={reducedMotion}
                onExpand={() => {
                  expandCluster(feature.clusterId, feature.lng, feature.lat);
                }}
              />
            </Marker>
          );
        }
        return (
          <Marker key={`point-${feature.point.id}`} longitude={feature.lng} latitude={feature.lat}>
            <CivicDotMarker
              point={feature.point}
              selected={feature.point.id === selectedId}
              onSelect={onSelectPoint}
            />
          </Marker>
        );
      })}
    </>
  );
}
