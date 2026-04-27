import { createFileRoute } from "@tanstack/react-router";
import { PricingPage, pricingSearchSchema } from "@/domains/billing/pages/public/pricing-page";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_public/pricing")({
  validateSearch: pricingSearchSchema,
  beforeLoad: () => {
    redirectIfLocalSession("/");
  },
  component: PricingRoute,
});

function PricingRoute() {
  const search = Route.useSearch();
  return <PricingPage intent={search.intent} interval={search.interval} />;
}
