import "@tanstack/react-start/server-only";

import { requireReadyAtlasSessionState } from "@/domains/access/server/session-state";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";

export { requestAtlasApi };

/**
 * Returns the active workspace id for server-side workspace product calls.
 *
 * @param missingWorkspaceMessage - User-facing error when no workspace is active.
 */
export async function requireActiveWorkspaceId(missingWorkspaceMessage: string): Promise<string> {
  const session = await requireReadyAtlasSessionState();
  const activeWorkspaceId = session.workspace.activeOrganization?.id;
  if (!activeWorkspaceId) {
    throw new Error(missingWorkspaceMessage);
  }

  return activeWorkspaceId;
}
