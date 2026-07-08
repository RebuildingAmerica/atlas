import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizeAtlasOrganizationMetadata } from "../access/organization-metadata";
import type { PricingCheckoutInterval } from "./checkout-types";
import { ATLAS_PRODUCTS } from "./products";

const checkoutInputSchema = z.object({
  product: z.enum(["atlas_pro", "atlas_team", "atlas_research_pass"]),
  interval: z.enum(["monthly", "yearly", "four_month", "once", "weekly"]),
});

async function loadCheckoutServerModules() {
  if (import.meta.env.SSR) {
    const [checkout, discountCoupons, stripeCustomer, auth, requestHeaders, runtime, sessionState] =
      await Promise.all([
        import("./server/checkout"),
        import("./server/discount-coupons"),
        import("./server/stripe-customer"),
        import("../access/server/auth"),
        import("../access/server/request-headers"),
        import("../access/server/runtime"),
        import("../access/server/session-state"),
      ]);
    return {
      checkout,
      discountCoupons,
      stripeCustomer,
      auth,
      requestHeaders,
      runtime,
      sessionState,
    };
  }

  throw new Error("Checkout server modules are only available on the server.");
}

/**
 * Resolves the Stripe price ID for a product and billing interval.
 */
function resolvePriceId(product: string, interval: PricingCheckoutInterval): string {
  if (product === "atlas_pro") {
    if (interval === "four_month") {
      return ATLAS_PRODUCTS.atlas_pro.studentFourMonthPriceId;
    }
    return interval === "yearly"
      ? ATLAS_PRODUCTS.atlas_pro.yearlyPriceId
      : ATLAS_PRODUCTS.atlas_pro.monthlyPriceId;
  }
  if (product === "atlas_team") {
    return interval === "yearly"
      ? ATLAS_PRODUCTS.atlas_team.yearlyPriceId
      : ATLAS_PRODUCTS.atlas_team.monthlyPriceId;
  }
  /* v8 ignore start -- checkoutInputSchema gates `product` to the literal union above; tsc cannot prove all branches return without the unreachable trailing throw */
  if (product === "atlas_research_pass") {
    return interval === "weekly"
      ? ATLAS_PRODUCTS.atlas_research_pass.weeklyPriceId
      : ATLAS_PRODUCTS.atlas_research_pass.oncePriceId;
  }
  throw new Error(`Unknown product: ${product}`);
  /* v8 ignore stop */
}

/**
 * Resolves the Stripe per-seat price ID for an Atlas Team billing interval.
 */
function resolveSeatPriceId(interval: string): string {
  return interval === "yearly"
    ? ATLAS_PRODUCTS.atlas_team.yearlySeatPriceId
    : ATLAS_PRODUCTS.atlas_team.monthlySeatPriceId;
}

/**
 * Creates a Stripe Checkout Session and returns the redirect URL.
 *
 * Requires an authenticated session with an active workspace. The workspace
 * ID and operator email are read from the current session context.
 */
export const startCheckout = createServerFn({ method: "POST" })
  .validator(checkoutInputSchema)
  .handler(async ({ data }) => {
    const {
      checkout,
      discountCoupons,
      stripeCustomer,
      auth: authModule,
      requestHeaders,
      runtime: runtimeModule,
      sessionState,
    } = await loadCheckoutServerModules();
    const { createCheckoutSession } = checkout;
    const { getDiscountCouponIdForCheckout } = discountCoupons;
    const { ensureStripeCustomerForWorkspace } = stripeCustomer;
    const { ensureAuthReady } = authModule;
    const { getBrowserSessionHeaders } = requestHeaders;
    const { getAuthRuntimeConfig } = runtimeModule;
    const { requireAtlasSessionState } = sessionState;
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
      discountCouponId = getDiscountCouponIdForCheckout(
        orgMetadata.discountSegment,
        data.product,
        data.interval,
      );
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

    // Atlas Team bills the base price (covering the owner) plus one seat per
    // additional member. The seat quantity reflects current membership;
    // syncTeamSeats keeps it accurate as members join or leave afterward.
    let seatPriceId: string | null = null;
    let seatQuantity = 0;
    if (data.product === "atlas_team") {
      const members = fullOrganization?.members;
      seatQuantity = Array.isArray(members) ? Math.max(0, members.length - 1) : 0;
      if (seatQuantity >= 1) {
        seatPriceId = resolveSeatPriceId(data.interval);
        if (!seatPriceId) {
          throw new Error(
            "Stripe seat price not configured for Atlas Team. Check environment variables.",
          );
        }
      }
    }

    const successUrl = new URL("/checkout-complete", runtime.publicBaseUrl);
    successUrl.searchParams.set("product", data.product);
    const cancelUrl = new URL("/pricing", runtime.publicBaseUrl);

    const result = await createCheckoutSession({
      workspaceId: activeWorkspace.id,
      product: data.product,
      interval: data.interval,
      priceId,
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
      customerEmail: session.user.email,
      stripeCustomerId,
      discountCouponId,
      seatPriceId,
      seatQuantity,
    });

    if (!result.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    return { url: result.url };
  });
