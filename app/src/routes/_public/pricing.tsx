import { createFileRoute } from "@tanstack/react-router";
import { PricingPage, pricingSearchSchema } from "@/domains/billing/pages/public/pricing-page";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_public/pricing")({
  validateSearch: pricingSearchSchema,
  beforeLoad: () => redirectIfLocalSession("/"),
  head: () => ({
    meta: [
      { title: "Pricing | Atlas" },
      {
        name: "description",
        content:
          "Choose Atlas access for individual research, team workflows, and civic data reuse.",
      },
    ],
  }),
  component: PricingRoute,
});

function PricingRoute() {
  const search = Route.useSearch();
  return <PricingPage intent={search.intent} interval={search.interval} />;
}
