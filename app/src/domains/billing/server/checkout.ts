import "@tanstack/react-start/server-only";

import type Stripe from "stripe";
import { getStripeClient } from "./stripe-client";

/**
 * Parameters required to create a Stripe Checkout Session for an Atlas
 * product purchase.
 */
interface CreateCheckoutOptions {
  workspaceId: string;
  product: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  stripeCustomerId?: string | null;
  discountCouponId?: string | null;
}

/**
 * Creates a Stripe Checkout Session for the given Atlas product.
 *
 * Subscription mode is used for recurring products (atlas_pro, atlas_team).
 * Payment mode is used for one-time purchases (atlas_research_pass).
 *
 * @param options - The checkout session parameters.
 */
export async function createCheckoutSession(
  options: CreateCheckoutOptions,
): Promise<{ url: string | null }> {
  const stripe = getStripeClient();
  const mode: Stripe.Checkout.SessionCreateParams["mode"] =
    options.product === "atlas_research_pass" ? "payment" : "subscription";

  const workspaceMetadata = {
    workspace_id: options.workspaceId,
    product: options.product,
  };

  const sharedParams: Pick<
    Stripe.Checkout.SessionCreateParams,
    "mode" | "line_items" | "success_url" | "cancel_url" | "metadata" | "subscription_data"
  > = {
    mode,
    line_items: [{ price: options.priceId, quantity: 1 }],
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    metadata: workspaceMetadata,
    // Propagate workspace context to subscription objects so webhook handlers
    // for customer.subscription.created can resolve the workspace without
    // relying solely on the checkout session.
    ...(mode === "subscription" && { subscription_data: { metadata: workspaceMetadata } }),
  };

  let sessionParams: Stripe.Checkout.SessionCreateParams;

  const baseParams = {
    ...sharedParams,
    ...(options.discountCouponId && { discounts: [{ coupon: options.discountCouponId }] }),
  };

  if (options.stripeCustomerId) {
    sessionParams = {
      ...baseParams,
      customer: options.stripeCustomerId,
    };
  } else {
    sessionParams = {
      ...baseParams,
      customer_email: options.customerEmail,
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return { url: session.url };
}
