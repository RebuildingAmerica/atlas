// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClaimContextRail } from "@/routes/_public/claim/-claim-context-rail";
import { ClaimHero } from "@/routes/_public/claim/-claim-state-panels";
import { ClaimSubmissionPanel } from "@/routes/_public/claim/-claim-submission-panel";
import {
  claimPanelNoop,
  claimAtprotoIdentity,
  createClaimSubmissionPanelProps,
  createOrganizationEntry,
  staleClaimCopyPatterns,
} from "./claim-submission-panel-test-support";

describe("profile verification copy", () => {
  afterEach(() => {
    cleanup();
    claimPanelNoop.mockClear();
  });

  it("describes organization verification without process-first phrasing", () => {
    const organizationEntry = createOrganizationEntry();
    const stalePatterns = staleClaimCopyPatterns();
    render(<ClaimHero entry={organizationEntry} />);

    expect(
      screen.getByText(
        "Verify that you can represent this organization. Show that updates come from someone connected to it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(stalePatterns.process)).not.toBeInTheDocument();
  });

  it("names reader-visible and private details without internal field language", () => {
    const organizationEntry = createOrganizationEntry();
    const stalePatterns = staleClaimCopyPatterns();
    render(<ClaimContextRail entry={organizationEntry} />);

    expect(screen.getByText("Shown to readers")).toBeInTheDocument();
    expect(screen.getByText("Profile details and contact preference.")).toBeInTheDocument();
    expect(screen.getByText("Not shown")).toBeInTheDocument();
    expect(screen.getByText("Your private note and sources.")).toBeInTheDocument();
    expect(screen.queryByText(stalePatterns.visibility)).not.toBeInTheDocument();
    expect(screen.queryByText(stalePatterns.privateProof)).not.toBeInTheDocument();
  });

  it("makes generic ATProto backup requirements specific to organization control", () => {
    const stalePatterns = staleClaimCopyPatterns();
    render(
      <ClaimSubmissionPanel
        {...createClaimSubmissionPanelProps({
          atprotoIdentities: [claimAtprotoIdentity("eastsidehousing.bsky.social")],
          selectedAtprotoIdentityId: "identity_1",
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Connect another account" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "This personal Bluesky-style handle needs an organization domain or workspace to confirm it belongs with this profile.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add the organization domain or use a workspace where you manage this organization.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No organization workspace connected.")).toBeInTheDocument();
    expect(screen.queryByText(stalePatterns.genericHandle)).not.toBeInTheDocument();
    expect(screen.queryByText(stalePatterns.workspaceAvailability)).not.toBeInTheDocument();
  });

  it("asks for connection evidence without review-system wording", () => {
    const stalePatterns = staleClaimCopyPatterns();
    render(<ClaimSubmissionPanel {...createClaimSubmissionPanelProps()} />);

    expect(screen.getByText("Show your connection")).toBeInTheDocument();
    expect(screen.getByText("Source for your connection")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Official site, staff page, organization email, public byline, or another source that connects you to this profile.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(stalePatterns.relationshipProof)).not.toBeInTheDocument();
  });
});
