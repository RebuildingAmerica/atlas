import Supercluster from "supercluster";
import type { MapBounds, MapPoint } from "@/types";

/**
 * The widest a co-located actor is nudged from its true coordinate, in degrees.
 *
 * ~0.05° is a few kilometers — invisible at country zoom, but enough that a
 * dozen actors sharing one city centroid fan into a readable ring instead of a
 * single opaque stack. The offset is deterministic per actor (see
 * {@link jitterOffset}) so a dot never twitches between renders.
 */
const JITTER_RADIUS_DEGREES = 0.05;

/** Cluster radius in pixels — how close two dots must be to merge into a bubble. */
const CLUSTER_RADIUS_PX = 56;

/** The deepest zoom at which actors still merge; past it every dot stands alone. */
const CLUSTER_MAX_ZOOM = 15;

/** A 2D nudge applied to an actor's coordinate, in degrees of lng/lat. */
export interface JitterOffset {
  dLng: number;
  dLat: number;
}

/**
 * The per-actor properties supercluster carries through indexing so a derived
 * feature can be turned straight back into a marker without a second lookup.
 */
export interface MapFeatureProperties {
  point: MapPoint;
}

/** A clustered group of actors, ready to render as an "alive count bubble." */
export interface ClusterFeature {
  kind: "cluster";
  clusterId: number;
  pointCount: number;
  lng: number;
  lat: number;
}

/** A single placed actor, ready to render as a civic dot. */
export interface IndividualFeature {
  kind: "point";
  point: MapPoint;
  lng: number;
  lat: number;
}

/** Either a cluster bubble or an individual dot for the current viewport. */
export type MapFeature = ClusterFeature | IndividualFeature;

/** A loaded supercluster index over jittered actor points. */
export type ClusterIndex = Supercluster<MapFeatureProperties>;

/** A feature returned by {@link Supercluster.getClusters}: a cluster or a point. */
export type RawClusterFeature = ReturnType<ClusterIndex["getClusters"]>[number];

/**
 * Narrow a raw supercluster feature to a cluster.
 *
 * Cluster features carry `cluster: true` in their properties; individual points
 * carry the actor projection instead. This guard reads the discriminant so the
 * derivation can branch with full type safety.
 */
function isClusterFeature(
  feature: RawClusterFeature,
): feature is Supercluster.ClusterFeature<Supercluster.AnyProps> {
  return "cluster" in feature.properties && feature.properties.cluster;
}

/**
 * Read the [lng, lat] of a feature, failing loudly on a malformed geometry.
 *
 * supercluster always emits 2D point geometries, so a missing ordinate would
 * mean the index itself is corrupt — we surface that rather than substitute a
 * silent zero that would drop an actor into the Gulf of Guinea.
 *
 * @param feature A raw supercluster feature.
 * @returns The longitude/latitude tuple.
 */
export function readLngLat(feature: RawClusterFeature): { lng: number; lat: number } {
  const [lng, lat] = feature.geometry.coordinates;
  if (lng === undefined || lat === undefined) {
    throw new Error("Clustered feature is missing a coordinate.");
  }
  return { lng, lat };
}

/**
 * Hash a string into an unsigned 32-bit integer with FNV-1a.
 *
 * A tiny, dependency-free hash that spreads similar ids (`actor-1`, `actor-2`)
 * to very different values, which is exactly what the jitter needs so adjacent
 * ids don't land on top of each other.
 *
 * @param value The string to hash.
 * @returns An unsigned 32-bit hash.
 */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Compute a stable jitter offset for an actor, seeded by its id.
 *
 * Co-located actors (same city centroid) would otherwise stack into one
 * unclickable dot. Hashing the id into an angle and a radius scatters them
 * around a small disc deterministically, so the same actor always lands in the
 * same spot and a crowded city reads as a constellation, not a blob. An empty
 * id yields no offset rather than a guessed one.
 *
 * @param id The actor's stable identifier.
 * @returns The lng/lat nudge to add to the actor's true coordinate.
 */
export function jitterOffset(id: string): JitterOffset {
  if (id === "") {
    return { dLng: 0, dLat: 0 };
  }
  const hash = hashString(id);
  // Split the hash into two independent 16-bit halves: one drives the angle,
  // the other the radius, so direction and distance vary independently.
  const angle = ((hash & 0xffff) / 0xffff) * Math.PI * 2;
  const radius = ((hash >>> 16) / 0xffff) * JITTER_RADIUS_DEGREES;
  return {
    dLng: Math.cos(angle) * radius,
    dLat: Math.sin(angle) * radius,
  };
}

/**
 * Build a supercluster index over the placed actors, applying deterministic
 * jitter so co-located actors separate cleanly.
 *
 * @param points The placed actors to index.
 * @returns A loaded supercluster index ready for {@link deriveMapFeatures}.
 */
export function buildClusterIndex(points: MapPoint[]): ClusterIndex {
  const index = new Supercluster<MapFeatureProperties>({
    radius: CLUSTER_RADIUS_PX,
    maxZoom: CLUSTER_MAX_ZOOM,
  });
  const features: Supercluster.PointFeature<MapFeatureProperties>[] = points.map((point) => {
    const { dLng, dLat } = jitterOffset(point.id);
    return {
      type: "Feature",
      properties: { point },
      geometry: {
        type: "Point",
        coordinates: [point.lng + dLng, point.lat + dLat],
      },
    };
  });
  index.load(features);
  return index;
}

/**
 * Derive the clusters and individual dots to render for a viewport.
 *
 * Re-clusters on every zoom client-side (no round trip), returning a uniform
 * list the marker layer maps over without caring which kind it's painting.
 *
 * @param index A loaded index from {@link buildClusterIndex}.
 * @param bounds The current viewport bounding box.
 * @param zoom The current (integer-floored) map zoom.
 * @returns The clusters and individual actors visible in the viewport.
 */
export function deriveMapFeatures(
  index: ClusterIndex,
  bounds: MapBounds,
  zoom: number,
): MapFeature[] {
  const features = index.getClusters(
    [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat],
    Math.floor(zoom),
  );
  return features.map((feature): MapFeature => {
    const { lng, lat } = readLngLat(feature);
    if (isClusterFeature(feature)) {
      return {
        kind: "cluster",
        clusterId: feature.properties.cluster_id,
        pointCount: feature.properties.point_count,
        lng,
        lat,
      };
    }
    return {
      kind: "point",
      point: feature.properties.point,
      lng,
      lat,
    };
  });
}
