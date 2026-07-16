import { describe, expect, it } from "vitest";
import {
  type MapSelection,
  isActorSelection,
  isClusterSelection,
  selectActor,
  selectCluster,
} from "@rebuildingamerica/atlas-catalog/map/map-selection";
import { makePoint } from "../../../../helpers/catalog/map-clustering-harness";

describe("map-selection", () => {
  it("builds an actor selection anchored at the actor's rendered coordinate", () => {
    const point = makePoint({ id: "a" });
    const selection = selectActor(point, { lng: -97.1, lat: 32.9 });
    expect(selection.kind).toBe("actor");
    expect(isActorSelection(selection)).toBe(true);
    expect(isClusterSelection(selection)).toBe(false);
    expect(selection.point).toBe(point);
    expect(selection.anchor).toEqual({ lng: -97.1, lat: 32.9 });
  });

  it("builds a cluster selection carrying the actors working in one place", () => {
    const members = [makePoint({ id: "a" }), makePoint({ id: "b" })];
    const selection = selectCluster(members, { lng: -100, lat: 40 }, 7);
    expect(selection.kind).toBe("cluster");
    expect(isClusterSelection(selection)).toBe(true);
    expect(isActorSelection(selection)).toBe(false);
    expect(selection.members).toBe(members);
    expect(selection.anchor).toEqual({ lng: -100, lat: 40 });
    expect(selection.clusterId).toBe(7);
  });

  it("narrows a selection to exactly one branch", () => {
    const actor: MapSelection = selectActor(makePoint({ id: "a" }), { lng: 0, lat: 0 });
    const cluster: MapSelection = selectCluster([makePoint({ id: "b" })], { lng: 1, lat: 1 }, 2);
    const both = [actor, cluster];
    const actorCount = both.filter(isActorSelection).length;
    const clusterCount = both.filter(isClusterSelection).length;
    expect(actorCount).toBe(1);
    expect(clusterCount).toBe(1);
  });
});
