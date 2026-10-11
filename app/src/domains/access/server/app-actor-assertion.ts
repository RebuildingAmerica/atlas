import "@tanstack/react-start/server-only";

import { ensureAuthReady } from "./auth";

/**
 * The audience the app sets on actor assertions and on nothing else, so no
 * customer token can ever be replayed as one.
 */
export const APP_ACTOR_AUDIENCE = "urn:atlas:app-actor";

/** One minute: long enough for one call, too short to be worth stealing. */
const ASSERTION_LIFETIME_SECONDS = 60;

interface AppActor {
  email: string;
  id: string;
}

interface AppActorOptions {
  /**
   * Whether the signed-in session has a verified email and a registered
   * passkey. The API grants operator authority only to ready sessions, so a
   * magic-link-only session can never act as the operator.
   */
  accountReady: boolean;
  organizationId?: string;
}

/**
 * Signs the short-lived assertion the API trusts to say who the app is acting
 * for.
 *
 * It replaces the shared secret the app used to send with actor headers: the
 * assertion is signed with the app's published keys, names one person, and
 * expires within a minute, so a leaked API host or database copy cannot mint
 * one.
 */
export async function createAppActorHeaders(
  actor: AppActor,
  options: AppActorOptions,
): Promise<Record<string, string>> {
  const auth = await ensureAuthReady();
  const issuedAt = Math.floor(Date.now() / 1000);
  const { token } = await auth.api.signJWT({
    body: {
      payload: {
        account_ready: options.accountReady,
        aud: APP_ACTOR_AUDIENCE,
        email: actor.email,
        exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
        iat: issuedAt,
        ...(options.organizationId ? { org_id: options.organizationId } : {}),
        sub: actor.id,
      },
    },
  });
  return { "X-Atlas-Actor-Assertion": token };
}
