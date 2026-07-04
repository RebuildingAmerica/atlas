import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type AtlasBriefConfidenceState = "corroborated" | "partial" | "unverified";
export type AtlasBriefExportFormat = "json";

export interface AtlasBriefScope {
  actor_types: string[];
  geography: string;
  issue_areas: string[];
  source_types: string[];
}

export interface AtlasBriefConfidenceSummary {
  review_status: string;
  source_count: number;
  state: AtlasBriefConfidenceState;
}

export interface AtlasBriefGap {
  detail: string;
  label: string;
}

export interface AtlasBrief {
  confidence_summary: AtlasBriefConfidenceSummary;
  created_at: string;
  created_by: string;
  gaps: AtlasBriefGap[];
  id: string;
  linked_discovery_run_ids: string[];
  linked_entry_ids: string[];
  linked_source_ids: string[];
  org_id: string;
  scope: AtlasBriefScope;
  summary: string;
  title: string;
  updated_at: string;
}

export interface AtlasBriefCreateInput {
  confidence_summary: AtlasBriefConfidenceSummary;
  gaps: AtlasBriefGap[];
  linked_discovery_run_ids: string[];
  linked_entry_ids: string[];
  linked_source_ids: string[];
  scope: AtlasBriefScope;
  summary: string;
  title: string;
}

export interface AtlasBriefUpdateInput {
  confidence_summary?: AtlasBriefConfidenceSummary;
  gaps?: AtlasBriefGap[];
  summary?: string;
  title?: string;
}

export interface AtlasBriefExportEntry {
  city?: string | null;
  id: string;
  name: string;
  state?: string | null;
  type: string;
}

export interface AtlasBriefExportSource {
  id: string;
  ingested_at: string;
  publication?: string | null;
  published_date?: string | null;
  title?: string | null;
  type: string;
  url: string;
}

export interface AtlasBriefExportDiscoveryRun {
  id: string;
  issue_areas: string[];
  location_query: string;
  research_goal: string;
  state: string;
  status: string;
}

export interface AtlasBriefExportProvenance {
  confidence_state: AtlasBriefConfidenceState;
  discovery_run_count: number;
  entry_count: number;
  review_status: string;
  source_count: number;
}

export interface AtlasBriefExport {
  brief: AtlasBrief;
  discovery_runs: AtlasBriefExportDiscoveryRun[];
  entries: AtlasBriefExportEntry[];
  format: AtlasBriefExportFormat;
  provenance: AtlasBriefExportProvenance;
  sources: AtlasBriefExportSource[];
}

export interface AtlasBriefCollection {
  items: AtlasBrief[];
  total: number;
}

const briefExportInputSchema = z.object({
  briefId: z.string().min(1),
});

const briefScopeSchema = z.object({
  actor_types: z.array(z.string().min(1)).min(1),
  geography: z.string().min(1),
  issue_areas: z.array(z.string().min(1)).min(1),
  source_types: z.array(z.string().min(1)).min(1),
});

const briefConfidenceSummarySchema = z.object({
  review_status: z.string().min(1),
  source_count: z.number().int().nonnegative(),
  state: z.enum(["corroborated", "partial", "unverified"]),
});

const briefGapSchema = z.object({
  detail: z.string().min(1),
  label: z.string().min(1),
});

const briefCreateInputSchema = z.object({
  confidence_summary: briefConfidenceSummarySchema,
  gaps: z.array(briefGapSchema),
  linked_discovery_run_ids: z.array(z.string().min(1)),
  linked_entry_ids: z.array(z.string().min(1)),
  linked_source_ids: z.array(z.string().min(1)),
  scope: briefScopeSchema,
  summary: z.string().min(1),
  title: z.string().min(1),
});

const briefUpdateInputSchema = z.object({
  confidence_summary: briefConfidenceSummarySchema.optional(),
  gaps: z.array(briefGapSchema).optional(),
  summary: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
});

const briefUpdateServerInputSchema = briefUpdateInputSchema
  .extend({
    briefId: z.string().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "briefId"), {
    message: "At least one brief field is required.",
  });

async function loadBriefServerModules() {
  if (import.meta.env.SSR) {
    const [sessionState, apiClient] = await Promise.all([
      import("@/domains/access/server/session-state"),
      import("@/domains/discovery/server/api-client"),
    ]);
    return { sessionState, apiClient };
  }

  throw new Error("Brief server modules are only available on the server.");
}

async function requireActiveWorkspaceId(): Promise<string> {
  const { sessionState } = await loadBriefServerModules();
  const { requireReadyAtlasSessionState } = sessionState;
  const session = await requireReadyAtlasSessionState();
  const activeWorkspaceId = session.workspace.activeOrganization?.id;
  if (!activeWorkspaceId) {
    throw new Error("Open a workspace before loading Atlas Briefs.");
  }

  return activeWorkspaceId;
}

/**
 * Loads a private Atlas Brief export for the signed-in workspace.
 *
 * @param briefId - Stable brief artifact identifier from the workspace route.
 * @returns Brief export with source receipts and linked actor context.
 */
export async function loadWorkspaceBriefExportData(briefId: string): Promise<AtlasBriefExport> {
  const normalizedBriefId = briefId.trim();
  if (!normalizedBriefId) {
    throw new Error("Brief id is required.");
  }

  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadBriefServerModules();
  const { requestAtlasApi } = apiClient;
  return await requestAtlasApi<AtlasBriefExport>(
    `/orgs/${encodeURIComponent(orgId)}/briefs/${encodeURIComponent(normalizedBriefId)}/export`,
  );
}

/**
 * Loads private Atlas Briefs for the signed-in workspace.
 *
 * @returns Workspace brief collection sorted by recent updates.
 */
export async function loadWorkspaceBriefsData(): Promise<AtlasBriefCollection> {
  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadBriefServerModules();
  const { requestAtlasApi } = apiClient;
  return await requestAtlasApi<AtlasBriefCollection>(`/orgs/${encodeURIComponent(orgId)}/briefs`);
}

/**
 * Creates a private Atlas Brief for the signed-in workspace.
 *
 * @param input - Source-linked brief fields to persist.
 * @returns Created workspace brief artifact.
 */
export async function createWorkspaceBriefData(input: AtlasBriefCreateInput): Promise<AtlasBrief> {
  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadBriefServerModules();
  const { requestAtlasApi } = apiClient;
  return await requestAtlasApi<AtlasBrief>(`/orgs/${encodeURIComponent(orgId)}/briefs`, {
    body: JSON.stringify(input),
    method: "POST",
  });
}

/**
 * Updates editable private Atlas Brief fields for the signed-in workspace.
 *
 * @param briefId - Stable brief artifact identifier.
 * @param input - Reviewed memo fields to update.
 * @returns Updated workspace brief artifact.
 */
export async function updateWorkspaceBriefData(
  briefId: string,
  input: AtlasBriefUpdateInput,
): Promise<AtlasBrief> {
  const normalizedBriefId = briefId.trim();
  if (!normalizedBriefId) {
    throw new Error("Brief id is required.");
  }

  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadBriefServerModules();
  const { requestAtlasApi } = apiClient;
  return await requestAtlasApi<AtlasBrief>(
    `/orgs/${encodeURIComponent(orgId)}/briefs/${encodeURIComponent(normalizedBriefId)}`,
    {
      body: JSON.stringify(input),
      method: "PATCH",
    },
  );
}

export const loadWorkspaceBriefExport = createServerFn({ method: "GET" })
  .inputValidator(briefExportInputSchema)
  .handler(async ({ data }) => {
    return await loadWorkspaceBriefExportData(data.briefId);
  });

export const loadWorkspaceBriefs = createServerFn({ method: "GET" }).handler(async () => {
  return await loadWorkspaceBriefsData();
});

export const createWorkspaceBrief = createServerFn({ method: "POST" })
  .inputValidator(briefCreateInputSchema)
  .handler(async ({ data }) => {
    return await createWorkspaceBriefData(data);
  });

export const updateWorkspaceBrief = createServerFn({ method: "POST" })
  .inputValidator(briefUpdateServerInputSchema)
  .handler(async ({ data }) => {
    const { briefId, ...input } = data;
    return await updateWorkspaceBriefData(briefId, input);
  });
