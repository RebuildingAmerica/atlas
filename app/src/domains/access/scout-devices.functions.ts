import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
  if (import.meta.env.SSR) {
    return await import("./server/scout-devices");
  }

  throw new Error("Scout devices are only available on the server.");
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
  .inputValidator(z.object({ deviceId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { requireAtlasSessionState } = await loadSessionStateModule();
    const { revokeScoutDevice: revokeStoredScoutDevice } = await loadScoutDevicesModule();
    const session = await requireAtlasSessionState();
    await revokeStoredScoutDevice({
      deviceId: data.deviceId,
      userId: session.user.id,
    });
  });
