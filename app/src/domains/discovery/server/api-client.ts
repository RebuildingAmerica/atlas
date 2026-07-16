import "@tanstack/react-start/server-only";

import { createInternalAuthHeaders } from "@/domains/access/config";
import {
  AtlasApiError,
  classifyAtlasApiStatus,
} from "@rebuildingamerica/atlas-catalog/discovery/api-errors";
import { requireReadyAtlasSessionState } from "@/domains/access/server/session-state";
import {
  getServerApiBaseUrl as getConfiguredServerApiBaseUrl,
  getServerServiceBaseUrl as getConfiguredServerServiceBaseUrl,
} from "@/platform/config/app-config";

function getServerApiBaseUrl(): string {
  return getConfiguredServerApiBaseUrl({
    ATLAS_PUBLIC_URL: process.env.ATLAS_PUBLIC_URL,
    ATLAS_SERVER_API_PROXY_TARGET: process.env.ATLAS_SERVER_API_PROXY_TARGET,
  });
}

function getServerServiceBaseUrl(): string {
  return getConfiguredServerServiceBaseUrl({
    ATLAS_PUBLIC_URL: process.env.ATLAS_PUBLIC_URL,
    ATLAS_SERVER_API_PROXY_TARGET: process.env.ATLAS_SERVER_API_PROXY_TARGET,
  });
}

function getInternalSecret(): string {
  return process.env.ATLAS_AUTH_INTERNAL_SECRET?.trim() || "";
}

function isLocalMode(): boolean {
  return process.env.ATLAS_DEPLOY_MODE === "local";
}

export async function requestAtlasApi<T>(path: string, init?: RequestInit): Promise<T> {
  return await requestAtlasBase<T>(getServerApiBaseUrl(), path, init);
}

export async function requestAtlasService<T>(path: string, init?: RequestInit): Promise<T> {
  return await requestAtlasBase<T>(getServerServiceBaseUrl(), path, init);
}

async function requestAtlasBase<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const localMode = isLocalMode();
  const internalSecret = getInternalSecret();
  if (!localMode && !internalSecret) {
    throw new Error("ATLAS_AUTH_INTERNAL_SECRET is required for authenticated discovery requests.");
  }

  const session = await requireReadyAtlasSessionState();
  const headers = localMode
    ? {}
    : createInternalAuthHeaders(session.user, internalSecret, {
        organizationId: session.workspace.activeOrganization?.id,
      });
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new AtlasApiError(classifyAtlasApiStatus(response.status));
  }

  return (await response.json()) as T;
}
