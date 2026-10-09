import { createFileRoute } from "@tanstack/react-router";

async function loadDiscountReviewResultModule() {
  if (import.meta.env.SSR) {
    return await import("@/domains/billing/server/internal-discount-review-result");
  }

  throw new Error("Discount review results are only accepted on the server.");
}

/**
 * Private callback the API uses to have the app email a discount applicant
 * the decision made in the platform admin.
 */
export const Route = createFileRoute("/api/auth/internal/discount-review-results")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleDiscountReviewResultRequest } = await loadDiscountReviewResultModule();

        return handleDiscountReviewResultRequest(request);
      },
    },
  },
});
