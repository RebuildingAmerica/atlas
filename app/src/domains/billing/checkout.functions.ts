import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createCheckoutSession } from "./server/checkout";
import { getDiscountCouponId } from "./server/discount-coupons";
import { ensureStripeCustomerForWorkspace } from "./server/stripe-customer";
import { ATLAS_PRODUCTS } from "./products";
import { ensureAuthReady } from "../access/server/auth";
import { getBrowserSessionHeaders } from "../access/server/request-headers";
import { getAuthRuntimeConfig } from "../access/server/runtime";
import { requireAtlasSessionState } from "../access/server/session-state";
import { normalizeAtlasOrganizationMetadata } from "../access/organization-metadata";

const checkoutInputSchema = z.object({
  product: z.enum(["atlas_pro", "atlas_team", "atlas_research_pass"]),
  interval: z.enum(["monthly", "yearly", "once", "weekly"]),
});

/**
 * Resolves the Stripe price ID for a product and billing interval.
 */
function resolvePriceId(product: string, interval: string): string {
  if (product === "atlas_pro") {
    return interval === "yearly"
      ? ATLAS_PRODUCTS.atlas_pro.yearlyPriceId
      : ATLAS_PRODUCTS.atlas_pro.monthlyPriceId;
  }
  if (product === "atlas_team") {
    return interval === "yearly"
      ? ATLAS_PRODUCTS.atlas_team.yearlyPriceId
      : ATLAS_PRODUCTS.atlas_team.monthlyPriceId;
  }
  if (product === "atlas_research_pass") {
    return interval === "weekly"
      ? ATLAS_PRODUCTS.atlas_research_pass.weeklyPriceId
      : ATLAS_PRODUCTS.atlas_research_pass.oncePriceId;
  }
  throw new Error(`Unknown product: ${product}`);
}

/**
 * Creates a Stripe Checkout Session and returns the redirect URL.
 *
 * Requires an authenticated session with an active workspace. The workspace
 * ID and operator email are read from the current session context.
 */
export const startCheckout = createServerFn({ method: "POST" })
  .inputValidator(checkoutInputSchema)
  .handler(async ({ data }) => {
    const priceId = resolvePriceId(data.product, data.interval);
    if (!priceId) {
      throw new Error("Stripe price not configured for this product. Check environment variables.");
    }

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

    let discountCouponId: string | null = null;
    if (orgMetadata.verificationStatus === "verified" && orgMetadata.discountSegment) {
      discountCouponId = getDiscountCouponId(orgMetadata.discountSegment);
    }

    // Ensure a Stripe customer exists before creating the checkout session.
    // This covers workspaces created before the pre-creation logic was added,
    // or cases where the initial creation attempt failed.
    let stripeCustomerId = orgMetadata.stripeCustomerId;
    if (!stripeCustomerId) {
      try {
        stripeCustomerId = await ensureStripeCustomerForWorkspace(
          activeWorkspace.id,
          session.user.email,
          activeWorkspace.name,
        );
      } catch {
        // Fall through to customer_email-based checkout.
      }
    }

    const successUrl = new URL("/checkout-complete", runtime.publicBaseUrl);
    successUrl.searchParams.set("product", data.product);
    const cancelUrl = new URL("/pricing", runtime.publicBaseUrl);

    const result = await createCheckoutSession({
      workspaceId: activeWorkspace.id,
      product: data.product,
      priceId,
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
      customerEmail: session.user.email,
      stripeCustomerId,
      discountCouponId,
    });

    if (!result.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    return { url: result.url };
  });
