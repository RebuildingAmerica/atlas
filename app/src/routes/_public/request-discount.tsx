import { createFileRoute } from "@tanstack/react-router";
import { RequestDiscountPage } from "@/domains/billing/pages/public/request-discount-page";

export const Route = createFileRoute("/_public/request-discount")({
  component: RequestDiscountPage,
});
