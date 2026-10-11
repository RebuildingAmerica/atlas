/** Loads a workspace route module and reads its page title. */
/** The one part of a route module this check reads. */
export interface RouteWithHead {
  Route: { options: { head?: unknown } };
}

/** The static head every titled workspace route returns. */
export interface StaticRouteHead {
  meta: { title: string }[];
}

// Every workspace page names itself, so a browser tab and a screen reader
// announce where the organizer is instead of an empty title.
export const WORKSPACE_PAGE_TITLES: [string, () => Promise<RouteWithHead>, string][] = [
  ["editorial", () => import("@/routes/_workspace/editorial/index"), "Editorial | Atlas"],
  [
    "editorial corrections",
    () => import("@/routes/_workspace/editorial/corrections"),
    "Correction inbox | Atlas editorial",
  ],
  [
    "editorial discovery review",
    () => import("@/routes/_workspace/editorial/discovery-reviews"),
    "Discovery review | Atlas editorial",
  ],
  [
    "editorial profile claims",
    () => import("@/routes/_workspace/editorial/profile-claims"),
    "Profile claims | Atlas editorial",
  ],
  [
    "editorial schedules",
    () => import("@/routes/_workspace/editorial/schedules"),
    "Discovery schedules | Atlas editorial",
  ],
  [
    "editorial takedowns",
    () => import("@/routes/_workspace/editorial/takedowns"),
    "Takedowns | Atlas editorial",
  ],
  ["feed", () => import("@/routes/_workspace/feed"), "Feed | Atlas"],
  ["research lists", () => import("@/routes/_workspace/lists/index"), "Research lists | Atlas"],
  ["research list", () => import("@/routes/_workspace/lists/$id"), "Research list | Atlas"],
  ["manage profile", () => import("@/routes/_workspace/manage/$slug"), "Manage profile | Atlas"],
  ["workspace", () => import("@/routes/_workspace/organization/index"), "Workspace | Atlas"],
  [
    "single sign-on",
    () => import("@/routes/_workspace/organization/sso"),
    "Single sign-on | Atlas",
  ],
];
