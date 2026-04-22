import { createFileRoute } from "@tanstack/react-router";
import { DiscountAdminPage } from "@/domains/billing/pages/discount-admin-page";

export const Route = createFileRoute("/_workspace/admin/discounts")({
  component: DiscountAdminPage,
});
