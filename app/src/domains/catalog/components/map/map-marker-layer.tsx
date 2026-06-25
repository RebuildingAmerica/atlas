import { useCallback, useMemo } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { MapBounds, MapPoint } from "@/types";
import { buildClusterIndex, deriveMapFeatures } from "@/domains/catalog/map/map-clustering";
import type { SelectionAnchor } from "@/domains/catalog/map/map-selection";
import { CivicDotMarker } from "./civic-dot-marker";
import { ClusterBubble } from "./cluster-bubble";

interface MapMarkerLayerProps {
  /** The placed actors currently fetched for the viewport. */
  points: MapPoint[];
  /** The viewport bounding box driving which features are derived. */
  bounds: MapBounds;
  /** The current map zoom, which decides what merges into a cluster. */
  zoom: number;
  /** The id of the actor whose panel is open, so its dot can read as selected. */
  selectedId?: string;
  /** Open an actor's detail panel, anchored at where its dot is rendered. */
  onSelectPoint: (point: MapPoint, anchor: SelectionAnchor) => void;
  /** Open a cluster's "who's working here" list with the actors it holds. */
  onSelectCluster: (members: MapPoint[], anchor: SelectionAnchor, clusterId: number) => void;
  /** Skip marker/cluster reveal motion for reduced-motion visitors. */
  reducedMotion?: boolean;
}

/**
 * The live layer of civic dots and count bubbles drawn over the basemap.
 *
 * It clusters the viewport's actors client-side (so a pan re-clusters with no
 * round trip) and renders each derived feature as a focusable marker. Clicking a
 * dot opens that actor's detail panel; clicking a count bubble opens the
 * panel's "who's working here" list of the actors gathered there — turning
 * "twelve here" into twelve names a visitor can step into — without forcing a
 * zoom they didn't ask for.
 */
export function MapMarkerLayer({
  points,
  bounds,
  zoom,
  selectedId,
  onSelectPoint,
  onSelectCluster,
  reducedMotion = false,
}: MapMarkerLayerProps) {
  const index = useMemo(() => buildClusterIndex(points), [points]);
  const features = useMemo(() => deriveMapFeatures(index, bounds, zoom), [index, bounds, zoom]);

  const openCluster = useCallback(
    (clusterId: number, lng: number, lat: number) => {
      const members = index.getLeaves(clusterId, Infinity).map((leaf) => leaf.properties.point);
      onSelectCluster(members, { lng, lat }, clusterId);
    },
    [index, onSelectCluster],
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
                onOpen={() => {
                  openCluster(feature.clusterId, feature.lng, feature.lat);
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
              onSelect={(point) => {
                onSelectPoint(point, { lng: feature.lng, lat: feature.lat });
              }}
            />
          </Marker>
        );
      })}
    </>
  );
}
