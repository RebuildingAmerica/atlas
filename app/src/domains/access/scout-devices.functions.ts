import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createInternalAuthHeaders } from "./config";

async function loadRuntimeModule() {
  if (import.meta.env.SSR) {
    return await import("./server/runtime");
  }

  throw new Error("Auth runtime is only available on the server.");
}

async function loadSessionStateModule() {
  if (import.meta.env.SSR) {
    return await import("./server/session-state");
  }

  throw new Error("Session state is only available on the server.");
}

async function loadScoutDevicesModule() {
  /* v8 ignore start -- No test can reach this: listScoutDevices awaits loadRuntimeModule() and revokeScoutDevice awaits loadSessionStateModule() first, and all three guards read the same import.meta.env.SSR, so stubbing SSR false always throws one of those messages before this line. The guard stays because TypeScript needs the throw to narrow away the undefined return. */
  if (import.meta.env.SSR) {
    return await import("./server/scout-devices");
  }

  throw new Error("Scout devices are only available on the server.");
  /* v8 ignore stop */
}

interface ScoutLeaseReleaseSession {
  user: {
    email: string;
    id: string;
  };
}

async function releaseScoutWorkerLeases(
  deviceId: string,
  session: ScoutLeaseReleaseSession,
): Promise<void> {
  const { getAuthRuntimeConfig } = await loadRuntimeModule();
  const runtime = getAuthRuntimeConfig();
  if (runtime.localMode || !runtime.apiBaseUrl) {
    return;
  }
  if (!runtime.internalSecret) {
    throw new Error("ATLAS_AUTH_INTERNAL_SECRET is required to revoke Scout worker leases.");
  }

  const releaseUrl = new URL(
    `/api/discovery-runs/jobs/workers/${encodeURIComponent(deviceId)}/release`,
    runtime.apiBaseUrl,
  );
  const response = await fetch(releaseUrl, {
    headers: {
      Accept: "application/json",
      ...createInternalAuthHeaders(session.user, runtime.internalSecret),
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Atlas could not release that Scout worker's active jobs.");
  }
}

/**
 * Lists Scout host devices enrolled by the current Atlas user.
 */
export const listScoutDevices = createServerFn({ method: "GET" }).handler(async () => {
  const { getAuthRuntimeConfig } = await loadRuntimeModule();
  const runtime = getAuthRuntimeConfig();
  if (runtime.localMode) {
    return [];
  }

  const { requireAtlasSessionState } = await loadSessionStateModule();
  const { listScoutDevicesForUser } = await loadScoutDevicesModule();
  const session = await requireAtlasSessionState();
  const devices = await listScoutDevicesForUser(session.user.id);
  return devices.map((device) => ({
    createdAt: device.createdAt,
    defaultUploadTarget: device.defaultUploadTarget,
    id: device.id,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
    searchKeyConfigured: device.searchKeyConfigured,
    workerName: device.workerName,
    workspaceId: device.workspaceId,
  }));
});

/**
 * Revokes one Scout device enrollment owned by the current Atlas user.
 */
export const revokeScoutDevice = createServerFn({ method: "POST" })
  .validator(z.object({ deviceId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { requireAtlasSessionState } = await loadSessionStateModule();
    const { revokeScoutDevice: revokeStoredScoutDevice } = await loadScoutDevicesModule();
    const session = await requireAtlasSessionState();
    await revokeStoredScoutDevice({
      deviceId: data.deviceId,
      userId: session.user.id,
    });
    await releaseScoutWorkerLeases(data.deviceId, session);
  });
