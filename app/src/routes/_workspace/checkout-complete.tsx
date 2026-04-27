import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CheckoutCompletePage } from "@/domains/billing/pages/workspace/checkout-complete-page";
import { redirectIfLocalSession } from "@/domains/access/server";

const checkoutCompleteSearchSchema = z.object({
  product: z.enum(["atlas_pro", "atlas_team", "atlas_research_pass"]).optional(),
});

export const Route = createFileRoute("/_workspace/checkout-complete")({
  validateSearch: checkoutCompleteSearchSchema,
  beforeLoad: () => {
    redirectIfLocalSession("/discovery");
  },
  component: CheckoutCompleteRoute,
});

function CheckoutCompleteRoute() {
  const search = Route.useSearch();
  return <CheckoutCompletePage product={search.product} />;
}
