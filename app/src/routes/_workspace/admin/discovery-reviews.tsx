import { createFileRoute } from "@tanstack/react-router";
import { DiscoveryReviewsPage } from "@/domains/admin/discovery-reviews-page";

export const Route = createFileRoute("/_workspace/admin/discovery-reviews")({
  component: DiscoveryReviewsPage,
});
