import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  CoverageTargetCollectionResponse,
  CoverageTargetCreateRequest,
  CoverageTargetDetailResponse,
  CoverageTargetImportRequest,
  CoverageTargetImportResponse,
  CoverageTargetResponse,
  CoverageTargetResponseStatus,
  CoverageUnderwritingReportResponse,
} from "@rebuildingamerica/atlas-api-client/generated/atlas";
import { requestWorkspaceApi, requireActiveWorkspaceId } from "./workspace-api";

export type CoverageTarget = CoverageTargetResponse;
export type CoverageTargetCollection = CoverageTargetCollectionResponse;
export type CoverageTargetCreateInput = CoverageTargetCreateRequest;
export type CoverageTargetDetail = CoverageTargetDetailResponse;
export type CoverageTargetImportInput = CoverageTargetImportRequest;
export type CoverageTargetImportResult = CoverageTargetImportResponse;
export type CoverageTargetStatus = CoverageTargetResponseStatus;
export type CoverageUnderwritingReport = CoverageUnderwritingReportResponse;

export interface CoverageWorkspacePayload {
  coverageTargets: CoverageTargetCollection;
  orgId: string;
}

const coverageTargetGapSchema = z.object({
  detail: z.string().min(1),
  label: z.string().min(1),
});

const coverageTargetCreateInputSchema = z.object({
  actor_types: z.array(z.string().min(1)).min(1),
  gaps: z.array(coverageTargetGapSchema).optional(),
  geography: z.string().min(1),
  issue_areas: z.array(z.string().min(1)).min(1),
  last_reviewed_at: z.string().nullable().optional(),
  linked_discovery_run_ids: z.array(z.string().min(1)).optional(),
  linked_entry_ids: z.array(z.string().min(1)).optional(),
  name: z.string().min(1),
  next_actions: z.array(z.string().min(1)).optional(),
  review_state: z.enum(["needs_research", "in_review", "ready_for_delivery"]).optional(),
  source_types: z.array(z.string().min(1)).min(1),
});

const coverageTargetDetailInputSchema = z.object({
  targetId: z.string().min(1),
});

const coverageTargetImportInputSchema = z.object({
  csv_text: z.string().min(1),
});

/**
 * Loads private coverage targets for the signed-in workspace.
 *
 * @returns Workspace coverage targets sorted by recent updates.
 */
export async function loadWorkspaceCoverageTargetsData(): Promise<CoverageTargetCollection> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading coverage targets.");
  return await requestWorkspaceApi<CoverageTargetCollection>(
    `/orgs/${encodeURIComponent(orgId)}/coverage-targets`,
  );
}

/**
 * Loads coverage workspace data for the signed-in workspace.
 *
 * @returns Workspace id plus coverage targets for route rendering and exports.
 */
export async function loadWorkspaceCoverageData(): Promise<CoverageWorkspacePayload> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading coverage targets.");
  const coverageTargets = await requestWorkspaceApi<CoverageTargetCollection>(
    `/orgs/${encodeURIComponent(orgId)}/coverage-targets`,
  );

  return { coverageTargets, orgId };
}

/**
 * Loads one coverage target with linked evidence for the signed-in workspace.
 *
 * @param targetId - Coverage target id from the workspace route.
 * @returns Target, linked research rows, and linked actor/source rows.
 */
export async function loadWorkspaceCoverageTargetDetailData(
  targetId: string,
): Promise<CoverageTargetDetail> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading coverage targets.");
  return await requestWorkspaceApi<CoverageTargetDetail>(
    `/orgs/${encodeURIComponent(orgId)}/coverage-targets/${encodeURIComponent(targetId)}`,
  );
}

/**
 * Loads the coverage underwriting report for the signed-in workspace.
 *
 * @returns Public impact, data boundary, and source-linked coverage target rows.
 */
export async function loadWorkspaceCoverageUnderwritingReportData(): Promise<CoverageUnderwritingReport> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading coverage targets.");
  return await requestWorkspaceApi<CoverageUnderwritingReport>(
    `/orgs/${encodeURIComponent(orgId)}/coverage-reports`,
  );
}

/**
 * Creates a private coverage target for the signed-in workspace.
 *
 * @param input - Place, issue, actor, and source scope for the target.
 * @returns Created workspace coverage target with derived status.
 */
export async function createWorkspaceCoverageTargetData(
  input: CoverageTargetCreateInput,
): Promise<CoverageTarget> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading coverage targets.");
  return await requestWorkspaceApi<CoverageTarget>(
    `/orgs/${encodeURIComponent(orgId)}/coverage-targets`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
  );
}

/**
 * Imports private coverage targets for the signed-in workspace.
 *
 * @param input - Customer onboarding CSV rows for coverage target creation.
 * @returns Created target count and created target records.
 */
export async function importWorkspaceCoverageTargetsData(
  input: CoverageTargetImportInput,
): Promise<CoverageTargetImportResult> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading coverage targets.");
  return await requestWorkspaceApi<CoverageTargetImportResult>(
    `/orgs/${encodeURIComponent(orgId)}/coverage-targets/import`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
  );
}

export const loadWorkspaceCoverageTargets = createServerFn({ method: "GET" }).handler(async () => {
  return await loadWorkspaceCoverageTargetsData();
});

export const loadWorkspaceCoverage = createServerFn({ method: "GET" }).handler(async () => {
  return await loadWorkspaceCoverageData();
});

export const loadWorkspaceCoverageTargetDetail = createServerFn({ method: "GET" })
  .validator(coverageTargetDetailInputSchema)
  .handler(async ({ data }) => {
    return await loadWorkspaceCoverageTargetDetailData(data.targetId);
  });

export const loadWorkspaceCoverageUnderwritingReport = createServerFn({
  method: "GET",
}).handler(async () => {
  return await loadWorkspaceCoverageUnderwritingReportData();
});

export const createWorkspaceCoverageTarget = createServerFn({ method: "POST" })
  .validator(coverageTargetCreateInputSchema)
  .handler(async ({ data }) => {
    return await createWorkspaceCoverageTargetData(data);
  });

export const importWorkspaceCoverageTargets = createServerFn({ method: "POST" })
  .validator(coverageTargetImportInputSchema)
  .handler(async ({ data }) => {
    return await importWorkspaceCoverageTargetsData(data);
  });
