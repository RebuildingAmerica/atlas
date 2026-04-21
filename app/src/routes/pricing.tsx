import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "@/domains/billing/pages/pricing-page";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});
