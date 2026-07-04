import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type { AtlasSessionPayload } from "./organization-contracts";

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

async function loadRpLogoutModule() {
  if (import.meta.env.SSR) {
    return await import("./server/rp-logout");
  }

  throw new Error("RP logout is only available on the server.");
}

/**
 * Returns whether Atlas is running in single-user (local) deployment mode.
 *
 * Vite does not expose ATLAS_DEPLOY_MODE to the browser bundle, so any
 * client-side env read returns false even when the server is running in
 * local mode. This server function is the only reliable way for client UI
 * to know the deployment mode without a session in scope (route loaders,
 * public layouts, etc.).
 */
export const getAtlasDeployMode = createServerFn({ method: "GET" }).handler(async () => {
  const { getAuthRuntimeConfig } = await loadRuntimeModule();
  return { localMode: getAuthRuntimeConfig().localMode };
});

/**
 * Returns the current operator session, or `null` when auth is enabled and no
 * session exists.
 */
export const getAtlasSession = createServerFn({ method: "GET" }).handler(async () => {
  const { loadAtlasSession } = await loadSessionStateModule();
  return await loadAtlasSession();
});

/**
 * Returns the current operator session or throws when the route is
 * unauthorized.
 */
export const ensureAtlasSession = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAtlasSessionState } = await loadSessionStateModule();
  return await requireAtlasSessionState();
});

/**
 * Returns the current operator session only when account setup is complete.
 */
export const ensureReadyAtlasSession = createServerFn({ method: "GET" }).handler(async () => {
  const { requireReadyAtlasSessionState } = await loadSessionStateModule();
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
    const { requestMagicLinkForEmail } = await loadSessionStateModule();
    return await requestMagicLinkForEmail(data);
  });

/**
 * Resends the current operator's verification email when their account is not
 * yet ready.
 */
export const sendVerificationEmail = createServerFn({ method: "POST" }).handler(async () => {
  const { sendVerificationEmailForCurrentSession } = await loadSessionStateModule();
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
    const { checkEmailAccountExists } = await loadSessionStateModule();
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
  const { loadOidcRpLogoutRedirect } = await loadRpLogoutModule();
  const url = await loadOidcRpLogoutRedirect();
  return { url };
});
