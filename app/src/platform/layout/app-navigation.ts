import type { AtlasSessionPayload } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";

/**
 * Navigation tab configuration shared by public and workspace shells.
 */
export interface AppNavItem {
  label: string;
  native?: boolean;
  to: string;
}

type AppNavigationSession = Pick<
  AtlasSessionPayload,
  "isInstanceOperator" | "isLocal" | "workspace"
>;

const CORE_APP_NAV: AppNavItem[] = [
  { label: "Home", to: "/home" },
  { label: "Research", to: "/discovery" },
  { label: "Coverage", to: "/coverage" },
  { label: "Briefs", to: "/briefs" },
  { label: "Browse", to: "/browse" },
  { label: "Lists", to: "/lists" },
  { label: "Watching", to: "/watching" },
  { label: "Activity", to: "/feed" },
];

/** Shown to the people who run this instance, including the local operator. */
const EDITORIAL_NAV_ITEM: AppNavItem = { label: "Editorial", to: "/editorial" };

/**
 * Returns whether the app shell should surface the organization tab for
 * the current session.
 *
 * @param session - The current Atlas session payload.
 */
export function shouldShowOrganizationNav(session: AppNavigationSession): boolean {
  const activeWorkspace = session.workspace.activeOrganization;

  return (
    session.workspace.onboarding.needsWorkspace ||
    session.workspace.onboarding.hasPendingInvitations ||
    session.workspace.capabilities.canSwitchOrganizations ||
    activeWorkspace?.workspaceType === "team"
  );
}

/**
 * Builds the authenticated app navigation shared by workspace and public pages.
 *
 * @param session - The current Atlas session payload.
 * @returns The app-level navigation items to render.
 */
export function buildAuthenticatedAppNav(
  session: AppNavigationSession | null | undefined,
): AppNavItem[] {
  if (!session) {
    return CORE_APP_NAV;
  }
  if (session.isLocal) {
    return [...CORE_APP_NAV, EDITORIAL_NAV_ITEM];
  }

  const items: AppNavItem[] = [...CORE_APP_NAV];

  if (session.isInstanceOperator) {
    items.push(EDITORIAL_NAV_ITEM);
  }

  if (shouldShowOrganizationNav(session)) {
    items.push({ label: "Organization", to: "/organization" });
  }

  items.push({ label: "Account", to: "/account" });

  return items;
}
