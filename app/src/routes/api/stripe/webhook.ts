import { createFileRoute } from "@tanstack/react-router";
import { handleStripeWebhook } from "@/domains/billing/server/webhook-handler";

/**
 * Stripe webhook endpoint mounted at `/api/stripe/webhook`.
 *
 * Stripe sends signed POST requests here for checkout completions,
 * subscription updates, and subscription cancellations.
 */
export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleStripeWebhook(request);
      },
    },
  },
});
