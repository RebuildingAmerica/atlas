import {
  useApproveProfileClaimReview,
  useProfileClaimReviews,
  useRejectProfileClaimReview,
  useRevalidateProfileAtprotoLinks,
} from "@/domains/catalog/hooks/use-claims";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { ProfileClaimReviewView } from "./profile-claim-review-view";

export function ProfileClaimReviewPage() {
  const hydrated = useHydrated();
  const reviews = useProfileClaimReviews({ enabled: hydrated });
  const approve = useApproveProfileClaimReview();
  const reject = useRejectProfileClaimReview();
  const revalidateAtproto = useRevalidateProfileAtprotoLinks();
  const claims = reviews.data?.items ?? [];
  const errorMessage = reviews.isError
    ? userFacingErrorMessage(reviews.error, "Profile verifications could not load.")
    : undefined;

  return (
    <ProfileClaimReviewView
      approving={approve.isPending}
      atprotoStatus={atprotoRevalidationLabel(revalidateAtproto.data?.needs_attention)}
      claims={claims}
      errorMessage={errorMessage}
      isLoading={reviews.isPending}
      onApprove={(claim, reason) => {
        approve.mutate({ claimId: claim.id, body: { reason: reason || null } });
      }}
      onReject={(claim, reason) => {
        reject.mutate({ claimId: claim.id, body: { reason } });
      }}
      onRevalidateAtproto={() => {
        revalidateAtproto.mutate();
      }}
      revalidatingAtproto={revalidateAtproto.isPending}
      rejecting={reject.isPending}
      total={reviews.data?.total ?? 0}
    />
  );
}

function atprotoRevalidationLabel(needsAttention: number | undefined): string {
  if (needsAttention === undefined) return "Not checked";
  if (needsAttention === 0) return "All current";
  return needsAttention === 1 ? "1 needs attention" : `${needsAttention} need attention`;
}
