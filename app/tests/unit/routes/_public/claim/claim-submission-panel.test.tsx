// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClaimSubmissionPanel } from "@/routes/_public/claim/-claim-submission-panel";
import {
  claimPanelNoop,
  claimAtprotoIdentity,
  createClaimSubmissionPanelProps,
} from "./claim-submission-panel-test-support";

describe("ClaimSubmissionPanel", () => {
  afterEach(() => {
    cleanup();
    claimPanelNoop.mockClear();
  });

  it("asks for organization backup when the connected ATProto account uses a Bluesky handle", () => {
    render(
      <ClaimSubmissionPanel
        {...createClaimSubmissionPanelProps({
          atprotoIdentities: [claimAtprotoIdentity("eastsidehousing.bsky.social")],
          selectedAtprotoIdentityId: "identity_1",
        })}
      />,
    );

    expect(
      screen.getByText(
        "This personal Bluesky-style handle needs an organization domain or workspace to confirm it belongs with this profile.",
      ),
    ).toBeInTheDocument();
  });

  it("does not submit a generic ATProto account without organization backup", () => {
    render(
      <ClaimSubmissionPanel
        {...createClaimSubmissionPanelProps({
          atprotoIdentities: [claimAtprotoIdentity("eastsidehousing.bsky.social")],
          selectedAtprotoIdentityId: "identity_1",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit verification" }));

    expect(claimPanelNoop).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Add the organization domain or use a workspace where you manage this organization.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit verification" })).toBeDisabled();
  });

  it("says the identity list is unavailable instead of offering an empty picker", () => {
    render(
      <ClaimSubmissionPanel
        {...createClaimSubmissionPanelProps({
          atprotoIdentitiesError: true,
        })}
      />,
    );

    expect(screen.getByText("Could not load ATProto identities.")).toBeInTheDocument();
    expect(screen.queryByLabelText("ATProto identity")).toBeNull();
    expect(screen.getByRole("button", { name: "Connect another account" })).toBeInTheDocument();
  });

  it("does not show the backup hint for a domain-based ATProto handle", () => {
    render(
      <ClaimSubmissionPanel
        {...createClaimSubmissionPanelProps({
          atprotoIdentities: [claimAtprotoIdentity("social.eastsidehousing.org")],
          selectedAtprotoIdentityId: "identity_1",
        })}
      />,
    );

    expect(
      screen.queryByText(
        "This personal Bluesky-style handle needs an organization domain or workspace to confirm it belongs with this profile.",
      ),
    ).not.toBeInTheDocument();
  });
});
