// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getClaimReviewHooks,
  setupProfileClaimReviewMocks,
  staleSubmittedSourcesPattern,
} from "./profile-claim-review-page-test-support";

describe("ProfileClaimReviewPage", () => {
  beforeEach(() => {
    setupProfileClaimReviewMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders pending verification sources and reviewer actions", async () => {
    const { ProfileClaimReviewPage } =
      await import("@/domains/catalog/pages/workspace/profile-claim-review-page");

    render(<ProfileClaimReviewPage />);

    expect(screen.getByText("Profile verifications")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Confirm representative access only when the submitted sources match the public profile.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Verification sources")).toBeInTheDocument();
    expect(screen.queryByText("Proof")).not.toBeInTheDocument();
    expect(screen.queryByText(staleSubmittedSourcesPattern())).not.toBeInTheDocument();
    expect(screen.getByText("Mississippi Rising")).toBeInTheDocument();
    expect(screen.getByText("operator@example.org")).toBeInTheDocument();
    expect(screen.getByText("mississippi-rising.bsky.social")).toBeInTheDocument();
    expect(screen.getByText("DID")).toBeInTheDocument();
    expect(screen.getByText("did:plc:generic")).toBeInTheDocument();
    expect(screen.getByText("PDS")).toBeInTheDocument();
    expect(screen.getByText("https://bsky.social")).toBeInTheDocument();
    expect(screen.getByText("Domain match")).toBeInTheDocument();
    expect(screen.getByText("Needs DNS or workspace")).toBeInTheDocument();
    expect(screen.getByText("Handle type")).toBeInTheDocument();
    expect(screen.getByText("Bluesky-hosted account")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Confirm the organization domain or workspace role before approving this ATProto account.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "DID did:plc:generic. PDS https://bsky.social. Handle does not match mississippirising.org. Confirm DNS or workspace role before approval.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Mississippi Rising - owner")).toBeInTheDocument();
    expect(screen.getByText("Organization domain")).toBeInTheDocument();
    expect(screen.getAllByText("mississippirising.org")).toHaveLength(2);
    expect(screen.getByText("TXT host")).toBeInTheDocument();
    expect(screen.getByText("_atlas-claim.mississippirising.org")).toBeInTheDocument();
    expect(screen.getByText("TXT value")).toBeInTheDocument();
    expect(screen.getByText("atlas-profile-claim=token")).toBeInTheDocument();
    expect(screen.getByText("Add the public ATProto account.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer note" }), {
      target: { value: "Website, workspace, and social profile match." },
    });
    const claimReviewHooks = getClaimReviewHooks();

    fireEvent.click(screen.getByRole("button", { name: "Approve Mississippi Rising" }));
    expect(claimReviewHooks.approve).toHaveBeenCalledWith({
      claimId: "claim_1",
      body: { note: "Website, workspace, and social profile match." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Reject Mississippi Rising" }));
    expect(claimReviewHooks.reject).toHaveBeenCalledWith({
      claimId: "claim_1",
      body: { note: "Website, workspace, and social profile match." },
    });
  });

  it("lets reviewers recheck linked ATProto profiles", async () => {
    const claimReviewHooks = getClaimReviewHooks();
    claimReviewHooks.useRevalidateProfileAtprotoLinks.mockReturnValue({
      data: { checked: 3, cleared: 1 },
      mutate: claimReviewHooks.revalidateAtproto,
      isPending: false,
    });
    const { ProfileClaimReviewPage } =
      await import("@/domains/catalog/pages/workspace/profile-claim-review-page");

    render(<ProfileClaimReviewPage />);

    expect(screen.getByText("ATProto links")).toBeInTheDocument();
    expect(screen.getByText("1 removed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recheck ATProto links" }));
    expect(claimReviewHooks.revalidateAtproto).toHaveBeenCalledOnce();
  });

  it("shows a clear status when linked ATProto profiles are current", async () => {
    const claimReviewHooks = getClaimReviewHooks();
    claimReviewHooks.useRevalidateProfileAtprotoLinks.mockReturnValue({
      data: { checked: 3, cleared: 0 },
      mutate: claimReviewHooks.revalidateAtproto,
      isPending: false,
    });
    const { ProfileClaimReviewPage } =
      await import("@/domains/catalog/pages/workspace/profile-claim-review-page");

    render(<ProfileClaimReviewPage />);

    expect(screen.getByText("All current")).toBeInTheDocument();
  });
});
