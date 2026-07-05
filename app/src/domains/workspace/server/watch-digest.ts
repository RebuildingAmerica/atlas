import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { WatchDigestItem, WatchDigestResponse } from "@/lib/generated/atlas";
import { requestWorkspaceApi, requireActiveWorkspaceId } from "./workspace-api";

export type WorkspaceWatchDigest = WatchDigestResponse;
export type WorkspaceWatchDigestItem = WatchDigestItem;

export interface WorkspaceWatchDigestInput {
  limit?: number;
}

const watchDigestInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
});

/**
 * Loads watch digest events for the signed-in workspace.
 *
 * @param limit - Maximum number of digest rows to return.
 * @returns Source-backed watch digest rows for the active workspace.
 */
export async function loadWorkspaceWatchDigestData(limit = 50): Promise<WorkspaceWatchDigest> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading watch digest.");
  return await requestWorkspaceApi<WorkspaceWatchDigest>(
    `/orgs/${encodeURIComponent(orgId)}/watch-digest?limit=${encodeURIComponent(String(limit))}`,
  );
}

export const loadWorkspaceWatchDigest = createServerFn({ method: "GET" })
  .validator(watchDigestInputSchema)
  .handler(async ({ data }) => {
    return await loadWorkspaceWatchDigestData(data.limit);
  });
