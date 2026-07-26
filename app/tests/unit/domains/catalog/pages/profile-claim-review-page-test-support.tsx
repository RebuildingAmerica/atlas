import { vi } from "vitest";

const claimReviewHooks = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
  revalidateAtproto: vi.fn(),
  useHydrated: vi.fn(() => true),
  useApproveProfileClaimReview: vi.fn(),
  useProfileClaimReviews: vi.fn(),
  useRejectProfileClaimReview: vi.fn(),
  useRevalidateProfileAtprotoLinks: vi.fn(),
}));

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useApproveProfileClaimReview: claimReviewHooks.useApproveProfileClaimReview,
  useProfileClaimReviews: claimReviewHooks.useProfileClaimReviews,
  useRejectProfileClaimReview: claimReviewHooks.useRejectProfileClaimReview,
  useRevalidateProfileAtprotoLinks: claimReviewHooks.useRevalidateProfileAtprotoLinks,
}));

vi.mock("@/platform/runtime/use-hydrated", () => ({
  useHydrated: claimReviewHooks.useHydrated,
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

export function getClaimReviewHooks() {
  return claimReviewHooks;
}

export function setupProfileClaimReviewMocks(): void {
  claimReviewHooks.approve.mockReset();
  claimReviewHooks.reject.mockReset();
  claimReviewHooks.revalidateAtproto.mockReset();
  claimReviewHooks.useHydrated.mockReset();
  claimReviewHooks.useHydrated.mockReturnValue(true);
  claimReviewHooks.useApproveProfileClaimReview.mockReturnValue({
    mutate: claimReviewHooks.approve,
    isPending: false,
  });
  claimReviewHooks.useRejectProfileClaimReview.mockReturnValue({
    mutate: claimReviewHooks.reject,
    isPending: false,
  });
  claimReviewHooks.useRevalidateProfileAtprotoLinks.mockReturnValue({
    data: undefined,
    mutate: claimReviewHooks.revalidateAtproto,
    isPending: false,
  });
  claimReviewHooks.useProfileClaimReviews.mockReturnValue({
    data: {
      items: [
        {
          id: "claim_1",
          entry_name: "Mississippi Rising",
          entry_slug: "mississippi-rising",
          status: "pending",
          tier: 2,
          user_email: "operator@example.org",
          evidence: {
            evidence: "The website links to this account.",
            requested_changes: "Add the public ATProto account.",
          },
          proofs: [
            {
              id: "proof_1",
              proof_type: "atproto",
              proof_status: "pending",
              proof_summary: "Linked ATProto handle mississippi-rising.bsky.social.",
              metadata: {
                did: "did:plc:generic",
                handle: "mississippi-rising.bsky.social",
                handle_is_generic: true,
                handle_domain_matches_entry: false,
                entry_domains: ["mississippirising.org"],
                pds_url: "https://bsky.social",
              },
              created_at: "2026-07-07T12:00:00Z",
            },
            {
              id: "proof_2",
              proof_type: "sso_admin",
              proof_status: "pending",
              proof_summary: "Workspace evidence is pending review.",
              metadata: { workspace_name: "Mississippi Rising", workspace_role: "owner" },
              created_at: "2026-07-07T12:00:00Z",
            },
            {
              id: "proof_3",
              proof_type: "domain_dns",
              proof_status: "pending",
              proof_summary: "Waiting for DNS record.",
              metadata: {
                domain: "mississippirising.org",
                challenge_host: "_atlas-claim.mississippirising.org",
                challenge_value: "atlas-profile-claim=token",
              },
              created_at: "2026-07-07T12:00:00Z",
            },
          ],
          created_at: "2026-07-07T12:00:00Z",
          updated_at: "2026-07-07T12:00:00Z",
          entry_id: "entry_1",
          user_id: "user_1",
        },
      ],
      total: 1,
    },
    isLoading: false,
  });
}

export function staleSubmittedSourcesPattern(): RegExp {
  return new RegExp(["submitted", "proof", "matches", "the", "public", "profile"].join(" "), "i");
}
