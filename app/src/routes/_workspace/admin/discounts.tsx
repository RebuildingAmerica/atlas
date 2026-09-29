import { createFileRoute } from "@tanstack/react-router";
import { DiscountAdminPage } from "@/domains/billing/pages/workspace/discount-admin-page";

export const Route = createFileRoute("/_workspace/admin/discounts")({
  head: () => ({ meta: [{ title: "Discount reviews | Atlas admin" }] }),
  component: DiscountAdminPage,
});
