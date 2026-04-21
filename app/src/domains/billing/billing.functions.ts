import { createServerFn } from "@tanstack/react-start";
import { getStripeClient } from "./server/stripe-client";
import { ensureAuthReady } from "../access/server/auth";
import { getBrowserSessionHeaders } from "../access/server/request-headers";
import { getAuthRuntimeConfig } from "../access/server/runtime";
import { requireAtlasSessionState } from "../access/server/session-state";
import { normalizeAtlasOrganizationMetadata } from "../access/organization-metadata";

/**
 * Creates a Stripe Customer Portal session and returns the portal URL.
 *
 * Requires an authenticated session with an active workspace that has a
 * Stripe customer ID in its organization metadata.
 */
export const createPortalSession = createServerFn({ method: "POST" }).handler(async () => {
  const session = await requireAtlasSessionState();
  const activeWorkspace = session.workspace.activeOrganization;

  if (!activeWorkspace) {
    throw new Error("Choose or create a workspace before managing billing.");
  }

  const auth = await ensureAuthReady();
  const headers = getBrowserSessionHeaders();
  const runtime = getAuthRuntimeConfig();

  const fullOrganization = await auth.api.getFullOrganization({
    headers,
    query: { organizationId: activeWorkspace.id },
  });

  const orgMetadata = normalizeAtlasOrganizationMetadata(fullOrganization?.metadata);

  if (!orgMetadata.stripeCustomerId) {
    throw new Error("No billing account found for this workspace. Purchase a product first.");
  }

  const stripe = getStripeClient();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: orgMetadata.stripeCustomerId,
    return_url: `${runtime.publicBaseUrl}/account`,
  });

  return { url: portalSession.url };
});
