import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function loadAuthModule() {
  if (import.meta.env.SSR) {
    return await import("./server/auth");
  }

  throw new Error("Auth is only available on the server.");
}

async function loadRequestHeadersModule() {
  if (import.meta.env.SSR) {
    return await import("./server/request-headers");
  }

  throw new Error("Request headers are only available on the server.");
}

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

/**
 * Lists all passkeys registered to the current operator session.
 */
export const listPasskeys = createServerFn({ method: "GET" }).handler(async () => {
  const { ensureAuthReady } = await loadAuthModule();
  const { getBrowserSessionHeaders } = await loadRequestHeadersModule();
  const { getAuthRuntimeConfig } = await loadRuntimeModule();
  const { requireAtlasSessionState } = await loadSessionStateModule();
  const runtime = getAuthRuntimeConfig();
  if (runtime.localMode) {
    return [];
  }

  await requireAtlasSessionState();
  const auth = await ensureAuthReady();
  const passkeys = await auth.api.listPasskeys({
    headers: getBrowserSessionHeaders(),
  });
  return (passkeys ?? []).map((pk) => ({
    ...pk,
    createdAt: pk.createdAt instanceof Date ? pk.createdAt.toISOString() : pk.createdAt,
  }));
});

/**
 * Deletes a passkey by ID for the current operator session.
 */
export const deletePasskey = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { ensureAuthReady } = await loadAuthModule();
    const { getBrowserSessionHeaders } = await loadRequestHeadersModule();
    const { requireAtlasSessionState } = await loadSessionStateModule();
    await requireAtlasSessionState();
    const auth = await ensureAuthReady();
    return await auth.api.deletePasskey({
      body: { id: data.id },
      headers: getBrowserSessionHeaders(),
    });
  });

/**
 * Renames a passkey for the current operator session.
 */
export const updatePasskey = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1), name: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { ensureAuthReady } = await loadAuthModule();
    const { getBrowserSessionHeaders } = await loadRequestHeadersModule();
    const { requireAtlasSessionState } = await loadSessionStateModule();
    await requireAtlasSessionState();
    const auth = await ensureAuthReady();
    return await auth.api.updatePasskey({
      body: { id: data.id, name: data.name },
      headers: getBrowserSessionHeaders(),
    });
  });
