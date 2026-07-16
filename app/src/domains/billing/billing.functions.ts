import { createServerFn } from "@tanstack/react-start";
import { normalizeAtlasOrganizationMetadata } from "@rebuildingamerica/atlas-access/workspace/organization-metadata";

async function loadBillingServerModules() {
  if (import.meta.env.SSR) {
    const [stripeClient, auth, requestHeaders, runtime, sessionState] = await Promise.all([
      import("./server/stripe-client"),
      import("../access/server/auth"),
      import("../access/server/request-headers"),
      import("../access/server/runtime"),
      import("../access/server/session-state"),
    ]);
    return { stripeClient, auth, requestHeaders, runtime, sessionState };
  }

  throw new Error("Billing server modules are only available on the server.");
}

/**
 * Creates a Stripe Customer Portal session and returns the portal URL.
 *
 * Requires an authenticated session with an active workspace that has a
 * Stripe customer ID in its organization metadata.
 */
export const createPortalSession = createServerFn({ method: "POST" }).handler(async () => {
  const {
    stripeClient,
    auth: authModule,
    requestHeaders,
    runtime: runtimeModule,
    sessionState,
  } = await loadBillingServerModules();
  const { ensureAuthReady } = authModule;
  const { getBrowserSessionHeaders } = requestHeaders;
  const { getAuthRuntimeConfig } = runtimeModule;
  const { requireAtlasSessionState } = sessionState;
  const { getStripeClient } = stripeClient;
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
    return_url: new URL("/account", runtime.publicBaseUrl).toString(),
  });

  return { url: portalSession.url };
});
