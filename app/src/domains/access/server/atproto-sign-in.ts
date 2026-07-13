import "@tanstack/react-start/server-only";

import { ensureAuthReady } from "./auth";

/**
 * Creates an Atlas browser session after the ATProto callback has resolved an
 * active controller. The Better Auth endpoint rejects HTTP callers, so a
 * browser can never nominate an arbitrary Atlas user ID for session creation.
 */
export async function createAtprotoSessionForUser(userId: string): Promise<Response> {
  const auth = await ensureAuthReady();
  return await auth.api.completeAtprotoSignIn({
    asResponse: true,
    body: { userId },
  });
}
