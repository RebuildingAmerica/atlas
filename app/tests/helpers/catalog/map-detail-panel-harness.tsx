import { makePoint } from "./map-clustering-harness";

/** A fully-fledged, verified organization actor for the panel's actor view. */
export const PANEL_ORG_ACTOR = makePoint({
  id: "actor-1",
  name: "Dallas Tenants United",
  type: "organization",
  slug: "dallas-tenants-united",
  place_label: "Dallas, TX",
  issue_areas: ["housing-affordability", "labor-organizing"],
  source_count: 3,
  trust_level: "atlas_verified",
});

/** Three co-located actors standing in for a cluster's "who's working here" crowd. */
export const PANEL_CLUSTER_MEMBERS = [
  makePoint({ id: "m1", name: "Austin Housing Coalition", type: "organization" }),
  makePoint({ id: "m2", name: "Maria Reyes", type: "person", trust_level: "unverified" }),
  makePoint({ id: "m3", name: "Houston Renters Union", type: "organization" }),
];
