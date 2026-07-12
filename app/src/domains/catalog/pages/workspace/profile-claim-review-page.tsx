import {
  useApproveProfileClaimReview,
  useProfileClaimReviews,
  useRejectProfileClaimReview,
  useRevalidateProfileAtprotoLinks,
} from "@/domains/catalog/hooks/use-claims";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import { ProfileClaimReviewView } from "./profile-claim-review-view";

export function ProfileClaimReviewPage() {
  const hydrated = useHydrated();
  const reviews = useProfileClaimReviews({ enabled: hydrated });
  const approve = useApproveProfileClaimReview();
  const reject = useRejectProfileClaimReview();
  const revalidateAtproto = useRevalidateProfileAtprotoLinks();
  const claims = reviews.data?.items ?? [];
  const errorMessage = reviews.isError
    ? reviews.error instanceof Error
      ? reviews.error.message
      : "Profile verifications could not load."
    : undefined;

  return (
    <ProfileClaimReviewView
      approving={approve.isPending}
      atprotoStatus={atprotoRevalidationLabel(revalidateAtproto.data?.cleared)}
      claims={claims}
      errorMessage={errorMessage}
      isLoading={reviews.isPending}
      onApprove={(claim, note) => {
        approve.mutate({
          claimId: claim.id,
          body: {
            note: reviewNote(note, "Reviewer approved from profile verification queue."),
          },
        });
      }}
      onReject={(claim, note) => {
        reject.mutate({
          claimId: claim.id,
          body: {
            note: reviewNote(note, "Reviewer could not confirm this representative."),
          },
        });
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

function atprotoRevalidationLabel(cleared: number | undefined): string {
  if (cleared === undefined) return "Not checked";
  if (cleared === 0) return "All current";
  return cleared === 1 ? "1 removed" : `${cleared} removed`;
}

function reviewNote(note: string, fallback: string): string {
  const trimmed = note.trim();
  return trimmed || fallback;
}
