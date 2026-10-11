import { createFileRoute } from "@tanstack/react-router";
import { ProfileClaimReviewPage } from "@/domains/catalog/pages/workspace/profile-claim-review-page";

export const Route = createFileRoute("/_workspace/editorial/profile-claims")({
  head: () => ({ meta: [{ title: "Profile claims | Atlas editorial" }] }),
  component: ProfileClaimReviewPage,
});
