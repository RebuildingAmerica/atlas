import "@tanstack/react-start/server-only";

import Stripe from "stripe";

let _stripe: Stripe | null = null;

/**
 * Returns the singleton Stripe SDK client for the current server process.
 *
 * The client is initialized lazily on first call and reused for the lifetime
 * of the process.
 */
export function getStripeClient(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_API_KEY?.trim();
    if (!key) {
      throw new Error("STRIPE_API_KEY is required for billing operations.");
    }
    _stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });
  }
  return _stripe;
}

/**
 * Returns the Stripe webhook signing secret from the process environment.
 */
export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required for webhook verification.");
  }
  return secret;
}
