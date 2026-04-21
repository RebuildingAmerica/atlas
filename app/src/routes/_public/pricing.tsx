import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "@/domains/billing/pages/pricing-page";

export const Route = createFileRoute("/_public/pricing")({
  component: PricingPage,
});
