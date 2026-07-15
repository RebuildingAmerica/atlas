import { createServerFn } from "@tanstack/react-start";
import type { OrgQualitySummaryResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import { requestWorkspaceApi, requireActiveWorkspaceId } from "./workspace-api";

export type WorkspaceQualitySummary = OrgQualitySummaryResponse;

/**
 * Loads the active workspace ingestion quality summary.
 *
 * @returns Source coverage, duplicate risk, confidence, and stale-record signals.
 */
export async function loadWorkspaceQualitySummaryData(): Promise<WorkspaceQualitySummary> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading quality summary.");
  return await requestWorkspaceApi<WorkspaceQualitySummary>(
    `/orgs/${encodeURIComponent(orgId)}/quality-summary`,
  );
}

export const loadWorkspaceQualitySummary = createServerFn({ method: "GET" }).handler(async () => {
  return await loadWorkspaceQualitySummaryData();
});
