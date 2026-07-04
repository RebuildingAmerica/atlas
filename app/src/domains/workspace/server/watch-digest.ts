import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { WatchDigestItem, WatchDigestResponse } from "@/lib/generated/atlas";

export type WorkspaceWatchDigest = WatchDigestResponse;
export type WorkspaceWatchDigestItem = WatchDigestItem;

export interface WorkspaceWatchDigestInput {
  limit?: number;
}

const watchDigestInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
});

async function loadWatchDigestServerModules() {
  if (import.meta.env.SSR) {
    const [sessionState, apiClient] = await Promise.all([
      import("@/domains/access/server/session-state"),
      import("@/domains/discovery/server/api-client"),
    ]);
    return { sessionState, apiClient };
  }

  throw new Error("Watch digest server modules are only available on the server.");
}

async function requireActiveWorkspaceId(): Promise<string> {
  const { sessionState } = await loadWatchDigestServerModules();
  const { requireReadyAtlasSessionState } = sessionState;
  const session = await requireReadyAtlasSessionState();
  const activeWorkspaceId = session.workspace.activeOrganization?.id;
  if (!activeWorkspaceId) {
    throw new Error("Open a workspace before loading watch digest.");
  }

  return activeWorkspaceId;
}

/**
 * Loads watch digest events for the signed-in workspace.
 *
 * @param limit - Maximum number of digest rows to return.
 * @returns Source-backed watch digest rows for the active workspace.
 */
export async function loadWorkspaceWatchDigestData(limit = 50): Promise<WorkspaceWatchDigest> {
  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadWatchDigestServerModules();
  const { requestAtlasApi } = apiClient;
  return await requestAtlasApi<WorkspaceWatchDigest>(
    `/orgs/${encodeURIComponent(orgId)}/watch-digest?limit=${encodeURIComponent(String(limit))}`,
  );
}

export const loadWorkspaceWatchDigest = createServerFn({ method: "GET" })
  .inputValidator(watchDigestInputSchema)
  .handler(async ({ data }) => {
    return await loadWorkspaceWatchDigestData(data.limit);
  });
