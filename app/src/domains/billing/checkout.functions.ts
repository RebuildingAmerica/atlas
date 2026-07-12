import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizeAtlasOrganizationMetadata } from "../access/organization-metadata";
import type { PricingCheckoutInterval } from "./checkout-types";
import { getAtlasBillingProducts } from "./products";
import type { AtlasBillingProducts } from "./products";

const checkoutInputSchema = z.object({
  product: z.enum(["atlas_pro", "atlas_team", "atlas_research_pass"]),
  interval: z.enum(["monthly", "yearly", "four_month", "once", "weekly"]),
});

async function loadCheckoutServerModules() {
  if (import.meta.env.SSR) {
    const [
      checkout,
      discountCoupons,
      discountVerifications,
      stripeCustomer,
      auth,
      requestHeaders,
      runtime,
      sessionState,
    ] = await Promise.all([
      import("./server/checkout"),
      import("./server/discount-coupons"),
      import("./server/discount-verifications"),
      import("./server/stripe-customer"),
      import("../access/server/auth"),
      import("../access/server/request-headers"),
      import("../access/server/runtime"),
      import("../access/server/session-state"),
    ]);
    return {
      checkout,
      discountCoupons,
      discountVerifications,
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
function resolvePriceId(
  products: AtlasBillingProducts,
  product: string,
  interval: PricingCheckoutInterval,
): string {
  if (product === "atlas_pro") {
    if (interval === "four_month") {
      return products.atlas_pro.studentFourMonthPriceId;
    }
    return interval === "yearly"
      ? products.atlas_pro.yearlyPriceId
      : products.atlas_pro.monthlyPriceId;
  }
  if (product === "atlas_team") {
    return interval === "yearly"
      ? products.atlas_team.yearlyPriceId
      : products.atlas_team.monthlyPriceId;
  }
  /* v8 ignore start -- checkoutInputSchema gates `product` to the literal union above; tsc cannot prove all branches return without the unreachable trailing throw */
  if (product === "atlas_research_pass") {
    return interval === "weekly"
      ? products.atlas_research_pass.weeklyPriceId
      : products.atlas_research_pass.oncePriceId;
  }
  throw new Error(`Unknown product: ${product}`);
  /* v8 ignore stop */
}

/**
 * Resolves the Stripe per-seat price ID for an Atlas Team billing interval.
 */
function resolveSeatPriceId(products: AtlasBillingProducts, interval: string): string {
  return interval === "yearly"
    ? products.atlas_team.yearlySeatPriceId
    : products.atlas_team.monthlySeatPriceId;
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
      discountVerifications,
      stripeCustomer,
      auth: authModule,
      requestHeaders,
      runtime: runtimeModule,
      sessionState,
    } = await loadCheckoutServerModules();
    const { createCheckoutSession } = checkout;
    const { getDiscountCouponIdForCheckout } = discountCoupons;
    const { getVerifiedDiscountSegmentForWorkspace } = discountVerifications;
    const { ensureStripeCustomerForWorkspace } = stripeCustomer;
    const { ensureAuthReady } = authModule;
    const { getBrowserSessionHeaders } = requestHeaders;
    const { getAuthRuntimeConfig } = runtimeModule;
    const { requireAtlasSessionState } = sessionState;
    const products = getAtlasBillingProducts();
    const priceId = resolvePriceId(products, data.product, data.interval);
    if (!priceId) {
      throw new Error("Stripe price not configured for this product. Check environment variables.");
    }

    const session = await requireAtlasSessionState();
    const activeWorkspace = session.workspace.activeOrganization;

    if (!activeWorkspace) {
      throw new Error("Create a workspace before continuing to payment.");
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
    const verifiedDiscountSegment = await getVerifiedDiscountSegmentForWorkspace(
      activeWorkspace.id,
    );
    if (verifiedDiscountSegment) {
      discountCouponId = getDiscountCouponIdForCheckout(
        verifiedDiscountSegment,
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
        seatPriceId = resolveSeatPriceId(products, data.interval);
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
