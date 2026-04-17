import type { AtlasSessionPayload, AtlasWorkspaceMembership } from "./session.types";
import { canManageAtlasOrganizationRole } from "./organization-metadata";
import { ensureAuthReady } from "./server/auth";
import { getBrowserSessionHeaders } from "./server/request-headers";
import { getAuthRuntimeConfig } from "./server/runtime";
import { requireAtlasSessionState } from "./server/session-state";

/**
 * Throws when organization management is requested while auth is disabled.
 */
export function assertOrganizationManagementEnabled(): void {
  const runtime = getAuthRuntimeConfig();
  if (runtime.localMode) {
    throw new Error("Organization management is unavailable while auth is disabled.");
  }
}

/**
 * Returns the browser-session context Atlas needs for Better Auth
 * organization operations.
 */
export async function loadOrganizationRequestContext() {
  assertOrganizationManagementEnabled();

  const session = await requireAtlasSessionState();
  const auth = await ensureAuthReady();
  const headers = getBrowserSessionHeaders();

  return { auth, headers, session };
}

/**
 * Returns the active workspace membership for the current session.
 *
 * @param session - The normalized Atlas session payload for the current user.
 */
export function requireActiveWorkspace(session: AtlasSessionPayload): AtlasWorkspaceMembership {
  const activeWorkspace = session.workspace.activeOrganization;
  if (!activeWorkspace) {
    throw new Error("Choose or create a workspace before managing organization settings.");
  }

  return activeWorkspace;
}

/**
 * Returns the active team workspace for the current session and verifies that
 * the current operator can manage it.
 *
 * @param session - The normalized Atlas session payload for the current user.
 */
export function requireManagedTeamWorkspace(
  session: AtlasSessionPayload,
): AtlasWorkspaceMembership {
  const activeWorkspace = requireActiveWorkspace(session);

  if (activeWorkspace.workspaceType !== "team") {
    throw new Error("Team management is only available inside team workspaces.");
  }

  if (!canManageAtlasOrganizationRole(activeWorkspace.role)) {
    throw new Error("You do not have permission to manage this workspace.");
  }

  return activeWorkspace;
}
