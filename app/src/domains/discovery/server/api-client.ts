import "@tanstack/react-start/server-only";

import { createInternalAuthHeaders } from "@/domains/access/config";
import { requireReadyAtlasSessionState } from "@/domains/access/server/session-state";
import { getServerApiBaseUrl as getConfiguredServerApiBaseUrl } from "@/platform/config/app-config";

function getServerApiBaseUrl(): string {
  return getConfiguredServerApiBaseUrl({
    ATLAS_PUBLIC_URL: process.env.ATLAS_PUBLIC_URL,
  });
}

function getInternalSecret(): string {
  return process.env.ATLAS_AUTH_INTERNAL_SECRET?.trim() || "";
}

export async function requestAtlasApi<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await requireReadyAtlasSessionState();
  const headers =
    session.isLocal || !getInternalSecret()
      ? {}
      : createInternalAuthHeaders(session.user, getInternalSecret(), {
          organizationId: session.workspace.activeOrganization?.id,
        });
  const response = await fetch(`${getServerApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Atlas API request failed (${response.status})`);
  }

  return (await response.json()) as T;
}
