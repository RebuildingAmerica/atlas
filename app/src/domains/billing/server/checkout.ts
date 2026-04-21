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

  const sharedParams: Pick<
    Stripe.Checkout.SessionCreateParams,
    "mode" | "line_items" | "success_url" | "cancel_url" | "metadata"
  > = {
    mode,
    line_items: [{ price: options.priceId, quantity: 1 }],
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    metadata: {
      workspace_id: options.workspaceId,
      product: options.product,
    },
  };

  let sessionParams: Stripe.Checkout.SessionCreateParams;

  if (options.stripeCustomerId) {
    sessionParams = {
      ...sharedParams,
      customer: options.stripeCustomerId,
    };
  } else {
    sessionParams = {
      ...sharedParams,
      customer_email: options.customerEmail,
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return { url: session.url };
}
