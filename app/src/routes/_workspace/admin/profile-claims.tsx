import { createFileRoute } from "@tanstack/react-router";
import { ProfileClaimReviewPage } from "@/domains/catalog/pages/workspace/profile-claim-review-page";

export const Route = createFileRoute("/_workspace/admin/profile-claims")({
  head: () => ({ meta: [{ title: "Profile claims | Atlas admin" }] }),
  component: ProfileClaimReviewPage,
});
