import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadOidcRpLogoutRedirect } from "./server/rp-logout";
import {
  checkEmailAccountExists,
  loadAtlasSession,
  requestMagicLinkForEmail,
  requireAtlasSessionState,
  requireReadyAtlasSessionState,
  sendVerificationEmailForCurrentSession,
} from "./server/session-state";

export type { AtlasSessionPayload } from "./organization-contracts";

/**
 * Returns the current operator session, or `null` when auth is enabled and no
 * session exists.
 */
export const getAtlasSession = createServerFn({ method: "GET" }).handler(async () => {
  return await loadAtlasSession();
});

/**
 * Returns the current operator session or throws when the route is
 * unauthorized.
 */
export const ensureAtlasSession = createServerFn({ method: "GET" }).handler(async () => {
  return await requireAtlasSessionState();
});

/**
 * Returns the current operator session only when account setup is complete.
 */
export const ensureReadyAtlasSession = createServerFn({ method: "GET" }).handler(async () => {
  return await requireReadyAtlasSessionState();
});

/**
 * Starts the magic-link sign-in flow for an email address.
 */
export const requestMagicLink = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      callbackURL: z.string().optional(),
      email: z.string().email(),
      name: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    return await requestMagicLinkForEmail(data);
  });

/**
 * Resends the current operator's verification email when their account is not
 * yet ready.
 */
export const sendVerificationEmail = createServerFn({ method: "POST" }).handler(async () => {
  return await sendVerificationEmailForCurrentSession();
});

/**
 * Checks whether an Atlas account already exists for a given email address.
 */
export const checkAccountExists = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email(),
    }),
  )
  .handler(async ({ data }) => {
    const exists = await checkEmailAccountExists(data.email);
    return { exists };
  });

/**
 * Returns the OIDC RP-Initiated Logout 1.0 redirect URL for the active
 * session, or `null` when no linked OIDC account exists or the IdP does not
 * advertise an `end_session_endpoint`.  Sign-out call sites invoke this
 * before clearing the local session and navigate to the returned URL after
 * `signOut()` so the federated session is terminated at the IdP.
 */
export const getRpLogoutRedirect = createServerFn({ method: "GET" }).handler(async () => {
  const url = await loadOidcRpLogoutRedirect();
  return { url };
});
