import { createFileRoute } from "@tanstack/react-router";

async function loadHandler() {
  if (import.meta.env.SSR) {
    return await import("@/domains/billing/server/runtime-inventory-route");
  }
  throw new Error("Billing inventory is only available on the server.");
}

export const Route = createFileRoute("/api/e2e/hosted/billing-inventory")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleRuntimeBillingInventoryRequest } = await loadHandler();
        return await handleRuntimeBillingInventoryRequest(request);
      },
    },
  },
});
