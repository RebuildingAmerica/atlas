import type { ReactNode } from "react";
import { makePoint } from "./map-clustering-harness";

/** The router `<Link>` props the detail panel hands a mocked router. */
export interface MockLinkProps {
  children: ReactNode;
  to: string;
  params?: { slug: string };
  hash?: string;
}

/**
 * A `<Link>` stand-in that resolves `to`, `params`, and `hash` into a real href.
 *
 * The panel test asserts the deep-link destinations (profile page, and the
 * `#connections` jump), so the mock must reproduce the same href the router
 * would build rather than merely echo `to`.
 */
export function MockLink({ children, to, params, hash }: MockLinkProps) {
  const slug = params?.slug ?? "";
  const href = `${to.replace("$slug", slug)}${hash ? `#${hash}` : ""}`;
  return <a href={href}>{children}</a>;
}

/** A fully-fledged, verified organization actor for the panel's actor view. */
export const PANEL_ORG_ACTOR = makePoint({
  id: "actor-1",
  name: "Dallas Tenants United",
  type: "organization",
  slug: "dallas-tenants-united",
  issue_areas: ["housing-affordability", "labor-organizing"],
  trust_level: "atlas_verified",
});

/** Three co-located actors standing in for a cluster's "who's working here" crowd. */
export const PANEL_CLUSTER_MEMBERS = [
  makePoint({ id: "m1", name: "Austin Housing Coalition", type: "organization" }),
  makePoint({ id: "m2", name: "Maria Reyes", type: "person", trust_level: "unverified" }),
  makePoint({ id: "m3", name: "Houston Renters Union", type: "organization" }),
];
