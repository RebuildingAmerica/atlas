import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  OrgIntegrationMonitoringResponse,
  OrgUsageSummaryResponse,
} from "@/lib/generated/atlas";
import { requestWorkspaceApi, requireActiveWorkspaceId } from "./workspace-api";

export type WorkspaceUsageSummary = OrgUsageSummaryResponse;
export type WorkspaceIntegrationMonitoring = OrgIntegrationMonitoringResponse;
export type WorkspaceEvidenceOpenSurface =
  "brief" | "coverage_target" | "watch_digest" | "saved_list" | "profile";

export interface RecordWorkspaceEvidenceOpenInput {
  sourceId: string;
  surface: WorkspaceEvidenceOpenSurface;
}

export interface WorkspaceUsageAuditLogDataBoundary {
  metadata_included: boolean;
  session_replay_included: boolean;
  statement: string;
}

export interface WorkspaceUsageEvent {
  actor_id: string | null;
  created_at: string;
  event_type: string;
  id: string;
  org_id: string;
  resource_id: string | null;
  resource_type: string | null;
}

export interface WorkspaceUsageAuditLog {
  data_boundary: WorkspaceUsageAuditLogDataBoundary;
  items: WorkspaceUsageEvent[];
  limit: number;
  offset: number;
  org_id: string;
  total: number;
}

export interface WorkspaceUsageAuditLogQueryInput {
  limit?: number;
  offset?: number;
}

const recordEvidenceOpenInputSchema = z.object({
  sourceId: z.string().min(1),
  surface: z.enum(["brief", "coverage_target", "watch_digest", "saved_list", "profile"]),
});

const usageAuditLogQueryInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .optional();

/**
 * Loads renewal usage proof for the signed-in workspace.
 *
 * @returns Usage event totals and renewal signal rollups for workspace admins.
 */
export async function loadWorkspaceUsageSummaryData(): Promise<WorkspaceUsageSummary> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading renewal proof.");
  return await requestWorkspaceApi<WorkspaceUsageSummary>(
    `/orgs/${encodeURIComponent(orgId)}/usage-summary`,
  );
}

/**
 * Loads the recent customer-safe usage audit log for the signed-in workspace.
 *
 * @param input - Optional pagination bounds for the audit-log request.
 * @returns Recent usage events without private metadata or session replay.
 */
export async function loadWorkspaceUsageAuditLogData(
  input: WorkspaceUsageAuditLogQueryInput = {},
): Promise<WorkspaceUsageAuditLog> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading renewal proof.");
  const limit = input.limit ?? 10;
  const offset = input.offset ?? 0;
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return await requestWorkspaceApi<WorkspaceUsageAuditLog>(
    `/orgs/${encodeURIComponent(orgId)}/usage-summary/audit-log?${params.toString()}`,
  );
}

/**
 * Loads customer-safe workspace integration activity for the signed-in workspace.
 *
 * @returns API and MCP usage counts without request metadata or session replay.
 */
export async function loadWorkspaceIntegrationMonitoringData(): Promise<WorkspaceIntegrationMonitoring> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading renewal proof.");
  return await requestWorkspaceApi<WorkspaceIntegrationMonitoring>(
    `/orgs/${encodeURIComponent(orgId)}/usage-summary/integrations`,
  );
}

/**
 * Records that a workspace user deliberately opened a source receipt.
 *
 * @param input - Source receipt and product surface where it was opened.
 * @returns Recorded non-invasive usage event.
 */
export async function recordWorkspaceEvidenceOpenData(
  input: RecordWorkspaceEvidenceOpenInput,
): Promise<WorkspaceUsageEvent> {
  const orgId = await requireActiveWorkspaceId("Open a workspace before loading renewal proof.");
  return await requestWorkspaceApi<WorkspaceUsageEvent>(
    `/orgs/${encodeURIComponent(orgId)}/usage-summary/evidence-opens`,
    {
      body: JSON.stringify({
        source_id: input.sourceId,
        surface: input.surface,
      }),
      method: "POST",
    },
  );
}

export const loadWorkspaceUsageSummary = createServerFn({ method: "GET" }).handler(async () => {
  return await loadWorkspaceUsageSummaryData();
});

export const loadWorkspaceUsageAuditLog = createServerFn({ method: "GET" })
  .validator(usageAuditLogQueryInputSchema)
  .handler(async ({ data }) => {
    return await loadWorkspaceUsageAuditLogData(data ?? {});
  });

export const loadWorkspaceIntegrationMonitoring = createServerFn({ method: "GET" }).handler(
  async () => {
    return await loadWorkspaceIntegrationMonitoringData();
  },
);

export const recordWorkspaceEvidenceOpen = createServerFn({ method: "POST" })
  .validator(recordEvidenceOpenInputSchema)
  .handler(async ({ data }) => {
    return await recordWorkspaceEvidenceOpenData(data);
  });
