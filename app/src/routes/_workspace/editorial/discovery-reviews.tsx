import { createFileRoute } from "@tanstack/react-router";
import { DiscoveryReviewsPage } from "@/domains/editorial/discovery-reviews-page";

export const Route = createFileRoute("/_workspace/editorial/discovery-reviews")({
  head: () => ({ meta: [{ title: "Discovery review | Atlas editorial" }] }),
  component: DiscoveryReviewsPage,
});
