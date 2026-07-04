import type { AtlasSessionPayload, AtlasWorkspaceMembership } from "./organization-contracts";
import { canManageAtlasOrganizationRole } from "./organization-metadata";

async function loadOrganizationServerModules() {
  if (import.meta.env.SSR) {
    const [auth, requestHeaders, runtime, sessionState] = await Promise.all([
      import("./server/auth"),
      import("./server/request-headers"),
      import("./server/runtime"),
      import("./server/session-state"),
    ]);
    return { auth, requestHeaders, runtime, sessionState };
  }

  throw new Error("Organization server modules are only available on the server.");
}

/**
 * Throws when organization management is requested while auth is disabled.
 */
export async function assertOrganizationManagementEnabled(): Promise<void> {
  const { runtime: runtimeModule } = await loadOrganizationServerModules();
  const { getAuthRuntimeConfig } = runtimeModule;
  const authRuntime = getAuthRuntimeConfig();
  if (authRuntime.localMode) {
    throw new Error("Organization management is unavailable while auth is disabled.");
  }
}

/**
 * Returns the browser-session context Atlas needs for Better Auth
 * organization operations.
 */
export async function loadOrganizationRequestContext() {
  await assertOrganizationManagementEnabled();

  const { auth: authModule, requestHeaders, sessionState } = await loadOrganizationServerModules();
  const { ensureAuthReady } = authModule;
  const { getBrowserSessionHeaders } = requestHeaders;
  const { requireAtlasSessionState } = sessionState;
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
