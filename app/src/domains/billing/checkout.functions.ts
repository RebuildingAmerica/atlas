import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createCheckoutSession } from "./server/checkout";
import { ensureAuthReady } from "../access/server/auth";
import { getBrowserSessionHeaders } from "../access/server/request-headers";
import { getAuthRuntimeConfig } from "../access/server/runtime";
import { requireAtlasSessionState } from "../access/server/session-state";
import { normalizeAtlasOrganizationMetadata } from "../access/organization-metadata";

const checkoutInputSchema = z.object({
  product: z.enum(["atlas_pro", "atlas_team", "atlas_research_pass"]),
  priceId: z.string().min(1),
});

/**
 * Creates a Stripe Checkout Session and returns the redirect URL.
 *
 * Requires an authenticated session with an active workspace. The workspace
 * ID and operator email are read from the current session context.
 */
export const startCheckout = createServerFn({ method: "POST" })
  .inputValidator(checkoutInputSchema)
  .handler(async ({ data }) => {
    const session = await requireAtlasSessionState();
    const activeWorkspace = session.workspace.activeOrganization;

    if (!activeWorkspace) {
      throw new Error("Choose or create a workspace before purchasing a product.");
    }

    const auth = await ensureAuthReady();
    const headers = getBrowserSessionHeaders();
    const runtime = getAuthRuntimeConfig();

    const fullOrganization = await auth.api.getFullOrganization({
      headers,
      query: { organizationId: activeWorkspace.id },
    });

    const orgMetadata = normalizeAtlasOrganizationMetadata(fullOrganization?.metadata);

    const successUrl = `${runtime.publicBaseUrl}/billing?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${runtime.publicBaseUrl}/billing`;

    const result = await createCheckoutSession({
      workspaceId: activeWorkspace.id,
      product: data.product,
      priceId: data.priceId,
      successUrl,
      cancelUrl,
      customerEmail: session.user.email,
      stripeCustomerId: orgMetadata.stripeCustomerId,
    });

    if (!result.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    return { url: result.url };
  });
