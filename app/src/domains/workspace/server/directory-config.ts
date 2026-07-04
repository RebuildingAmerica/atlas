import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DirectoryConfigRequest, DirectoryConfigResponse } from "@/lib/generated/atlas";

export type WorkspaceDirectoryConfig = DirectoryConfigResponse;
export type WorkspaceDirectoryConfigInput = DirectoryConfigRequest;

const publicDirectoryScopeSchema = z.object({
  entry_types: z.array(z.string().min(1)).optional(),
  geography_labels: z.array(z.string().min(1)).optional(),
  issue_area_ids: z.array(z.string().min(1)).optional(),
});

const publicDirectoryMethodologySchema = z.object({
  correction_path_template: z.string().min(1).optional(),
  correction_policy: z.string().min(1).optional(),
  missing_context_path_template: z.string().min(1).optional(),
  review_policy: z.string().min(1).optional(),
  source_policy: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
});

const directoryConfigInputSchema = z.object({
  methodology: publicDirectoryMethodologySchema.nullable().optional(),
  scope: publicDirectoryScopeSchema.nullable().optional(),
  sponsor_label: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).nullable().optional(),
});

async function loadDirectoryConfigServerModules() {
  if (import.meta.env.SSR) {
    const [sessionState, apiClient] = await Promise.all([
      import("@/domains/access/server/session-state"),
      import("@/domains/discovery/server/api-client"),
    ]);
    return { sessionState, apiClient };
  }

  throw new Error("Directory config server modules are only available on the server.");
}

async function requireActiveWorkspaceId(): Promise<string> {
  const { sessionState } = await loadDirectoryConfigServerModules();
  const { requireReadyAtlasSessionState } = sessionState;
  const session = await requireReadyAtlasSessionState();
  const activeWorkspaceId = session.workspace.activeOrganization?.id;
  if (!activeWorkspaceId) {
    throw new Error("Open a workspace before editing public directory settings.");
  }

  return activeWorkspaceId;
}

/**
 * Loads the public directory configuration for the signed-in workspace.
 */
export async function loadWorkspaceDirectoryConfigData(): Promise<WorkspaceDirectoryConfig> {
  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadDirectoryConfigServerModules();
  const { requestAtlasApi } = apiClient;
  return await requestAtlasApi<WorkspaceDirectoryConfig>(
    `/orgs/${encodeURIComponent(orgId)}/entries/directory-config`,
  );
}

/**
 * Updates the public directory configuration for the signed-in workspace.
 */
export async function updateWorkspaceDirectoryConfigData(
  input: WorkspaceDirectoryConfigInput,
): Promise<WorkspaceDirectoryConfig> {
  const orgId = await requireActiveWorkspaceId();
  const { apiClient } = await loadDirectoryConfigServerModules();
  const { requestAtlasApi } = apiClient;
  return await requestAtlasApi<WorkspaceDirectoryConfig>(
    `/orgs/${encodeURIComponent(orgId)}/entries/directory-config`,
    {
      body: JSON.stringify(input),
      method: "PUT",
    },
  );
}

export const loadWorkspaceDirectoryConfig = createServerFn({ method: "GET" }).handler(async () => {
  return await loadWorkspaceDirectoryConfigData();
});

export const updateWorkspaceDirectoryConfig = createServerFn({ method: "POST" })
  .inputValidator(directoryConfigInputSchema)
  .handler(async ({ data }) => {
    return await updateWorkspaceDirectoryConfigData(data);
  });
