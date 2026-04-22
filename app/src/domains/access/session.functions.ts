import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  checkEmailAccountExists,
  loadAtlasSession,
  requestMagicLinkForEmail,
  requireAtlasSessionState,
  requireReadyAtlasSessionState,
  sendVerificationEmailForCurrentSession,
} from "./server/session-state";

export type { AtlasSessionPayload } from "./session.types";

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
