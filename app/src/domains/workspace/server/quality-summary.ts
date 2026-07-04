import { createServerFn } from "@tanstack/react-start";
import type { OrgQualitySummaryResponse } from "@/lib/generated/atlas";

export type WorkspaceQualitySummary = OrgQualitySummaryResponse;

async function loadQualitySummaryServerModules() {
  if (import.meta.env.SSR) {
    const [sessionState, apiClient] = await Promise.all([
      import("@/domains/access/server/session-state"),
      import("@/domains/discovery/server/api-client"),
    ]);
    return { sessionState, apiClient };
  }

  throw new Error("Quality summary server modules are only available on the server.");
}

async function requireActiveWorkspaceId(): Promise<string> {
  const { sessionState } = await loadQualitySummaryServerModules();
  const { requireReadyAtlasSessionState } = sessionState;
  const session = await requireReadyAtlasSessionState();
  const activeWorkspaceId = session.workspace.activeOrganization?.id;
  if (!activeWorkspaceId) {
    throw new Error("Open a workspace before loading quality summary.");
  }

  return activeWorkspaceId;
}

/**
 * Loads the active workspace ingestion quality summary.
 *
 * @returns Source coverage, duplicate risk, confidence, and stale-record signals.
 */
export async function loadWorkspaceQualitySummaryData(): Promise<WorkspaceQualitySummary> {
  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadQualitySummaryServerModules();
  const { requestAtlasApi } = apiClient;
  return await requestAtlasApi<WorkspaceQualitySummary>(
    `/orgs/${encodeURIComponent(orgId)}/quality-summary`,
  );
}

export const loadWorkspaceQualitySummary = createServerFn({ method: "GET" }).handler(async () => {
  return await loadWorkspaceQualitySummaryData();
});
