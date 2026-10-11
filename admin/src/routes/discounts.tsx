import { createFileRoute } from "@tanstack/react-router";
import { DiscountReviewPage } from "@/domains/discounts/discount-review-page";

export const Route = createFileRoute("/discounts")({
  head: () => ({
    meta: [{ title: "Discount requests | Atlas platform admin" }],
  }),
  component: DiscountReviewPage,
});
