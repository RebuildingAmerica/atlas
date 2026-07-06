import { createFileRoute } from "@tanstack/react-router";

async function loadWebhookModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/billing/server/webhook-handler");
  }

  /* v8 ignore next -- TanStack server handlers execute with SSR enabled; this guard protects accidental client imports. */
  throw new Error("Stripe webhook handling is only available on the server.");
}

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
        const { handleStripeWebhook } = await loadWebhookModule();
        return handleStripeWebhook(request);
      },
    },
  },
});
