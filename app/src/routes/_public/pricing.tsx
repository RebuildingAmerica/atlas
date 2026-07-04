import { createFileRoute } from "@tanstack/react-router";
import { PricingPage, pricingSearchSchema } from "@/domains/billing/pages/public/pricing-page";
import { redirectIfLocalSession } from "@/domains/access/server";
import { buildPageHead } from "@/platform/seo";

export const Route = createFileRoute("/_public/pricing")({
  validateSearch: pricingSearchSchema,
  beforeLoad: () => redirectIfLocalSession("/"),
  head: () =>
    buildPageHead({
      title: "Pricing | Atlas",
      description:
        "Choose Atlas access for individual research, team workflows, and civic data reuse.",
      path: "/pricing",
    }),
  component: PricingRoute,
});

function PricingRoute() {
  const search = Route.useSearch();
  return <PricingPage intent={search.intent} interval={search.interval} />;
}
