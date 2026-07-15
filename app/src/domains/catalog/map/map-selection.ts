import type { MapPoint } from "@rebuildingamerica/atlas-api-client";

/** A longitude/latitude the camera should keep in view beside the open panel. */
export interface SelectionAnchor {
  lng: number;
  lat: number;
}

/**
 * A single actor's detail is open in the panel.
 *
 * Carries the rendered coordinate (post-jitter) rather than the actor's raw
 * point so the camera nudges to exactly where the dot sits on screen, keeping
 * the marker a visitor just clicked visible beside the panel.
 */
export interface ActorSelection {
  kind: "actor";
  point: MapPoint;
  anchor: SelectionAnchor;
}

/**
 * A cluster's "who's working here" list is open in the panel.
 *
 * Holds the actors that merged into the bubble so the list renders without a
 * second round trip, plus the bubble's coordinate and id for the camera and for
 * the optional zoom-to-expand affordance.
 */
export interface ClusterSelection {
  kind: "cluster";
  members: MapPoint[];
  anchor: SelectionAnchor;
  clusterId: number;
}

/** What the detail panel is currently showing: one actor, or a crowd. */
export type MapSelection = ActorSelection | ClusterSelection;

/**
 * Open one actor in the panel.
 *
 * @param point The actor a visitor clicked.
 * @param anchor The actor's rendered coordinate, so the camera frames it.
 * @returns An actor selection.
 */
export function selectActor(point: MapPoint, anchor: SelectionAnchor): ActorSelection {
  return { kind: "actor", point, anchor };
}

/**
 * Open a cluster's crowd in the panel.
 *
 * @param members The actors that merged into the bubble.
 * @param anchor The bubble's coordinate, so the camera frames it.
 * @param clusterId The supercluster id, so the panel can offer "zoom in here".
 * @returns A cluster selection.
 */
export function selectCluster(
  members: MapPoint[],
  anchor: SelectionAnchor,
  clusterId: number,
): ClusterSelection {
  return { kind: "cluster", members, anchor, clusterId };
}

/** Narrow a selection to the single-actor branch. */
export function isActorSelection(selection: MapSelection): selection is ActorSelection {
  return selection.kind === "actor";
}

/** Narrow a selection to the cluster branch. */
export function isClusterSelection(selection: MapSelection): selection is ClusterSelection {
  return selection.kind === "cluster";
}
