interface WorkspaceApiServerModule {
  requestAtlasApi: <T>(path: string, init?: RequestInit) => Promise<T>;
  requireActiveWorkspaceId: (missingWorkspaceMessage: string) => Promise<string>;
}

async function loadWorkspaceApiServer(): Promise<WorkspaceApiServerModule> {
  if (import.meta.env.SSR) {
    return await import("@/domains/workspace/server/workspace-api.server");
  }

  throw new Error("Workspace API server helpers are only available on the server.");
}

/**
 * Returns the active workspace id inside a server function handler.
 *
 * @param missingWorkspaceMessage - User-facing error when no workspace is active.
 */
export async function requireActiveWorkspaceId(missingWorkspaceMessage: string): Promise<string> {
  const { requireActiveWorkspaceId: requireId } = await loadWorkspaceApiServer();
  return await requireId(missingWorkspaceMessage);
}

/**
 * Calls the Atlas API from a workspace server function handler.
 *
 * @param path - API path relative to the configured Atlas API base URL.
 * @param init - Fetch options forwarded to the API client.
 */
export async function requestWorkspaceApi<T>(path: string, init?: RequestInit): Promise<T> {
  const { requestAtlasApi } = await loadWorkspaceApiServer();
  if (init === undefined) {
    return await requestAtlasApi<T>(path);
  }

  return await requestAtlasApi<T>(path, init);
}
