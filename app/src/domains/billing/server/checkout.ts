import "@tanstack/react-start/server-only";

import type Stripe from "stripe";
import { getStripeClient } from "./stripe-client";

/**
 * Parameters required to create a Stripe Checkout Session for an Atlas
 * product purchase.
 */
export interface CreateCheckoutOptions {
  workspaceId: string;
  product: string;
  interval?: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  stripeCustomerId?: string | null;
  discountCouponId?: string | null;
  /**
   * Stripe price for the per-seat add-on (Atlas Team). When present alongside a
   * positive `seatQuantity`, a second line item bills each member beyond the
   * one covered by the base price.
   */
  seatPriceId?: string | null;
  /** Number of additional seats to bill (members beyond the base-covered one). */
  seatQuantity?: number;
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
  if (options.product === "atlas_research_pass" && !options.interval) {
    throw new Error("Research Pass checkout requires an interval.");
  }

  const workspaceMetadata = {
    workspace_id: options.workspaceId,
    product: options.product,
    ...(options.interval ? { interval: options.interval } : {}),
  };

  // Base price covers the workspace (and the owner's seat). For Atlas Team,
  // each additional member is billed through a separate seat line item whose
  // quantity tracks membership (see syncTeamSeats).
  const lineItems: Stripe.Checkout.SessionCreateParams["line_items"] = [
    { price: options.priceId, quantity: 1 },
  ];
  const seatQuantity = options.seatQuantity ?? 0;
  if (options.seatPriceId && seatQuantity >= 1) {
    lineItems.push({ price: options.seatPriceId, quantity: seatQuantity });
  }

  const sharedParams: Pick<
    Stripe.Checkout.SessionCreateParams,
    "mode" | "line_items" | "success_url" | "cancel_url" | "metadata" | "subscription_data"
  > = {
    mode,
    line_items: lineItems,
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
