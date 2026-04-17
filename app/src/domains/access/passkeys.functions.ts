import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ensureAuthReady } from "./server/auth";
import { getBrowserSessionHeaders } from "./server/request-headers";
import { getAuthRuntimeConfig } from "./server/runtime";
import { requireAtlasSessionState } from "./server/session-state";

/**
 * Lists all passkeys registered to the current operator session.
 */
export const listPasskeys = createServerFn({ method: "GET" }).handler(async () => {
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
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
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
  .inputValidator(z.object({ id: z.string().min(1), name: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAtlasSessionState();
    const auth = await ensureAuthReady();
    return await auth.api.updatePasskey({
      body: { id: data.id, name: data.name },
      headers: getBrowserSessionHeaders(),
    });
  });
