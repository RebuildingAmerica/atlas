import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "@/domains/billing/pages/pricing-page";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_public/pricing")({
  beforeLoad: () => redirectIfLocalSession("/"),
  component: PricingPage,
});
