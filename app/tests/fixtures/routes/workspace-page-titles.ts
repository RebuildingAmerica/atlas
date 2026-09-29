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
  ["admin", () => import("@/routes/_workspace/admin/index"), "Admin | Atlas"],
  [
    "admin cloud costs",
    () => import("@/routes/_workspace/admin/cloud-costs"),
    "Cloud costs | Atlas admin",
  ],
  [
    "admin corrections",
    () => import("@/routes/_workspace/admin/corrections"),
    "Correction inbox | Atlas admin",
  ],
  [
    "admin discounts",
    () => import("@/routes/_workspace/admin/discounts"),
    "Discount reviews | Atlas admin",
  ],
  [
    "admin editorial review",
    () => import("@/routes/_workspace/admin/discovery-reviews"),
    "Editorial review | Atlas admin",
  ],
  [
    "admin profile claims",
    () => import("@/routes/_workspace/admin/profile-claims"),
    "Profile claims | Atlas admin",
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
