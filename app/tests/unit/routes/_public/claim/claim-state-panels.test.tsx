// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProfileClaimProofResponse,
  ProfileClaimResponse,
} from "@rebuildingamerica/atlas-api-client/generated/atlas";
import { PendingClaimPanel, VerifiedClaimPanel } from "@/routes/_public/claim/-claim-state-panels";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("claim state panels", () => {
  function personEntry(): Entry {
    return {
      id: "e1",
      name: "Jane Rivera",
      slug: "jane-rivera",
      type: "person",
      source_count: 1,
    } as Entry;
  }

  function pendingClaim(proofs: ProfileClaimProofResponse[]): ProfileClaimResponse {
    return {
      created_at: "2026-07-07T12:00:00Z",
      entry_id: "e1",
      id: "claim_1",
      proofs,
      status: "pending",
      tier: 2,
      updated_at: "2026-07-07T12:00:00Z",
      user_id: "user_1",
    } as ProfileClaimResponse;
  }

  function proof(overrides: Partial<ProfileClaimProofResponse>): ProfileClaimProofResponse {
    return {
      created_at: "2026-07-07T12:00:00Z",
      id: "proof_1",
      metadata: null,
      proof_status: "pending",
      proof_summary: "Waiting for review.",
      proof_type: "atproto",
      ...overrides,
    };
  }

  afterEach(() => {
    cleanup();
  });

  it("tells a verified person what readers now see and where to edit", () => {
    render(<VerifiedClaimPanel entry={personEntry()} profilePath="/profiles/people/jane-rivera" />);

    expect(screen.getByText("Readers can now see that this profile is verified.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Edit profile" })).toHaveAttribute(
      "href",
      "/manage/jane-rivera",
    );
    expect(screen.getByRole("link", { name: "View public profile" })).toHaveAttribute(
      "href",
      "/profiles/people/jane-rivera",
    );
  });

  it("tells a verified organization that it now has a representative on record", () => {
    render(
      <VerifiedClaimPanel
        entry={
          {
            id: "e2",
            name: "Eastside Housing Network",
            slug: "eastside-housing-network",
            type: "organization",
            source_count: 3,
          } as Entry
        }
        profilePath="/profiles/organizations/eastside-housing-network"
      />,
    );

    expect(screen.getByText("This organization now has a verified representative.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Edit profile" })).toHaveAttribute(
      "href",
      "/manage/eastside-housing-network",
    );
  });

  it("falls back to each proof's own summary when its metadata carries no detail", () => {
    render(
      <PendingClaimPanel
        claim={pendingClaim([
          proof({
            id: "proof_atproto",
            proof_summary: "Linked ATProto account.",
            proof_type: "atproto",
          }),
          proof({
            id: "proof_workspace",
            metadata: "not-an-object",
            proof_summary: "Workspace role under review.",
            proof_type: "sso_admin",
          }),
        ])}
        isVerifyingDomain={false}
        onVerifyDomain={() => Promise.resolve(true)}
      />,
    );

    expect(screen.getByText("ATProto account")).toBeInTheDocument();
    expect(screen.getByText("Linked ATProto account.")).toBeInTheDocument();
    expect(screen.getByText("Workspace role")).toBeInTheDocument();
    expect(screen.getByText("Workspace role under review.")).toBeInTheDocument();
    expect(screen.getAllByText("Needs review")).toHaveLength(2);
  });

  it("names the outcome once a proof is confirmed or rejected", () => {
    render(
      <PendingClaimPanel
        claim={pendingClaim([
          proof({
            id: "proof_atproto",
            metadata: { handle: "acme.org" },
            proof_status: "verified",
            proof_type: "atproto",
          }),
          proof({
            id: "proof_dns",
            metadata: { domain: "acme.org" },
            proof_status: "rejected",
            proof_type: "domain_dns",
          }),
        ])}
        isVerifyingDomain={false}
        onVerifyDomain={() => Promise.resolve(true)}
      />,
    );

    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  it("leaves out proofs it cannot describe rather than showing an empty row", () => {
    render(
      <PendingClaimPanel
        claim={pendingClaim([
          proof({ id: "proof_dns", metadata: {}, proof_type: "domain_dns" }),
          proof({ id: "proof_email", proof_type: "email" }),
        ])}
        isVerifyingDomain={false}
        onVerifyDomain={() => Promise.resolve(true)}
      />,
    );

    expect(screen.queryByText("Connection details")).toBeNull();
    expect(screen.queryByText("Organization domain")).toBeNull();
    expect(screen.getByText("Verification under review")).toBeInTheDocument();
  });

  it("hides the DNS instructions when the challenge record is incomplete", () => {
    render(
      <PendingClaimPanel
        claim={pendingClaim([
          proof({
            id: "proof_dns",
            metadata: { challenge_host: "_atlas-claim.acme.org", domain: "acme.org" },
            proof_type: "domain_dns",
          }),
        ])}
        isVerifyingDomain={false}
        onVerifyDomain={() => Promise.resolve(true)}
      />,
    );

    expect(screen.getByText("Organization domain")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check DNS" })).toBeNull();
    expect(screen.queryByText("_atlas-claim.acme.org")).toBeNull();
  });

  it("tells a tier-one claimant to check their email instead of waiting on a reviewer", () => {
    render(
      <PendingClaimPanel
        claim={{ ...pendingClaim([]), tier: 1 }}
        isVerifyingDomain={false}
        onVerifyDomain={() => Promise.resolve(true)}
      />,
    );

    expect(screen.getByText("Check your email to finish verification.")).toBeInTheDocument();
  });
});
