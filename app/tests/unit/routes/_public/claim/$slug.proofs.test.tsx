// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupOrganizationClaimTest,
  cleanupRenderedOrganizationClaim,
  clickSubmitVerification,
  clipboardMocks,
  mockInitiateClaim,
  renderOrganizationClaim,
  setupOrganizationClaimTest,
  toastMocks,
} from "./organization-claim-test-support";

describe("routes/_public/claim/$slug organization proofs", () => {
  beforeEach(async () => {
    await setupOrganizationClaimTest();
  });

  afterEach(() => {
    cleanupOrganizationClaimTest();
  });

  it("submits organization ATProto and DNS record fields", async () => {
    const initiateMock = await mockInitiateClaim();

    await renderOrganizationClaim({ atprotoHandle: "acme.org", atprotoIdentityId: "atp_1" });
    expect(screen.getByRole("option", { name: "acme.org" })).toBeInTheDocument();
    expect(screen.queryByText("This is me")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /use my workspace role/i })).toBeDisabled();
    expect(
      screen.getByText(
        "Choose an account connected in Account settings or connect another account.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Organization domain"), {
      target: { value: "acme.org" },
    });
    await clickSubmitVerification();

    expect(initiateMock).toHaveBeenCalledWith({
      slug: "acme",
      body: {
        atproto_identity_id: "atp_1",
        dns_domain: "acme.org",
        relationship: "organization_representative",
      },
    });
  });

  it("does not submit an identity that needs attention during the draft", async () => {
    const initiateMock = await mockInitiateClaim();

    await renderOrganizationClaim({
      atprotoHandle: "acme.org",
      atprotoIdentityId: "atp_1",
      atprotoIdentityStatus: "needs_attention",
    });

    await clickSubmitVerification();

    expect(initiateMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reconnect this ATProto account or choose another identity.",
    );
  });

  it("starts ATProto OAuth from the organization proof step", async () => {
    const assignMock = vi.fn();
    const sessionStorage = window.sessionStorage;
    vi.stubGlobal("window", {
      location: {
        assign: assignMock,
        origin: "https://atlas.test",
        pathname: "/claim/acme",
        href: "https://atlas.test/claim/acme?atprotoError=ATProto+identity+could+not+be+verified.&atprotoHandle=acme.org",
        search: "?atprotoError=ATProto+identity+could+not+be+verified.&atprotoHandle=acme.org",
      },
      sessionStorage,
    });

    await renderOrganizationClaim();
    fireEvent.change(screen.getByRole("textbox", { name: "Source for your connection" }), {
      target: { value: "https://acme.org/team" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Another ATProto handle" }), {
      target: { value: "acme.org" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect another account" }));

    expect(assignMock).toHaveBeenCalledWith(
      "https://atlas.test/api/atproto/oauth/start?handle=acme.org&returnTo=%2Fclaim%2Facme",
    );
    expect(JSON.parse(sessionStorage.getItem("atlas:claim-draft:acme") ?? "null")).toMatchObject({
      evidence: "https://acme.org/team",
      relationship: "organization_representative",
    });
  });

  it("submits active workspace role for organization verification", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        user: { id: "u1" },
        workspace: {
          activeOrganization: { id: "org_1", name: "Acme", role: "owner" },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);
    const initiateMock = await mockInitiateClaim();

    await renderOrganizationClaim();
    fireEvent.click(screen.getByRole("checkbox", { name: /use my workspace role/i }));
    await clickSubmitVerification();

    expect(initiateMock).toHaveBeenCalledWith({
      slug: "acme",
      body: {
        relationship: "organization_representative",
        use_active_workspace: true,
      },
    });
  });

  it.each([
    ["plain", "Could not start verification."],
    [new Error("bad"), "bad"],
  ])("surfaces initiate failure copy", async (rejection, message) => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(rejection),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);

    await renderOrganizationClaim();
    await clickSubmitVerification();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("does not verify when no email token is present", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const verifyMock = vi.fn();
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: verifyMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [{ entry_id: "e1", status: "pending", tier: 1 }],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    await renderOrganizationClaim();
    expect(screen.getByText("Verification under review")).toBeInTheDocument();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("shows a pending DNS challenge and checks the server-side resolver", async () => {
    vi.useFakeTimers();
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const verifyDomainMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useVerifyClaimDomain).mockReturnValue({
      mutateAsync: verifyDomainMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimDomain>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [
        {
          id: "claim_1",
          entry_id: "e1",
          status: "pending",
          tier: 2,
          proofs: [
            {
              id: "proof_1",
              proof_type: "domain_dns",
              proof_status: "pending",
              proof_summary: "Waiting for DNS record.",
              metadata: {
                challenge_host: "_atlas-claim.acme.org",
                challenge_value: "atlas-profile-claim=token",
              },
              created_at: "2026-07-07T12:00:00Z",
            },
          ],
        },
      ],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    await renderOrganizationClaim();

    expect(screen.getByText(/Updates can take a few minutes/)).toBeInTheDocument();
    expect(screen.getByText("_atlas-claim.acme.org")).toBeInTheDocument();
    expect(screen.getByText("atlas-profile-claim=token")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Host" }));
      await Promise.resolve();
    });
    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("_atlas-claim.acme.org");
    expect(toastMocks.success).toHaveBeenCalledWith("Host copied");
    expect(screen.getByRole("button", { name: "Host copied" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(screen.getByRole("button", { name: "Copy Host" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check DNS" }));
      await Promise.resolve();
    });
    expect(verifyDomainMock).toHaveBeenCalledWith({ claimId: "claim_1", slug: "acme" });
    expect(screen.getByRole("button", { name: "Check again soon" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "DNS checked. Try again in about a minute.",
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("button", { name: "Check DNS" })).toBeEnabled();
  });

  it("does not start DNS retry cooldown after a failed check", async () => {
    vi.useFakeTimers();
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const verifyDomainMock = vi.fn().mockRejectedValue(new Error("DNS lookup failed"));
    vi.mocked(claims.useVerifyClaimDomain).mockReturnValue({
      mutateAsync: verifyDomainMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimDomain>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [
        {
          id: "claim_1",
          entry_id: "e1",
          status: "pending",
          tier: 2,
          proofs: [
            {
              id: "proof_1",
              proof_type: "domain_dns",
              proof_status: "pending",
              proof_summary: "Waiting for DNS record.",
              metadata: {
                challenge_host: "_atlas-claim.acme.org",
                challenge_value: "atlas-profile-claim=token",
              },
              created_at: "2026-07-07T12:00:00Z",
            },
          ],
        },
      ],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    await renderOrganizationClaim();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check DNS" }));
      await Promise.resolve();
    });

    expect(verifyDomainMock).toHaveBeenCalledWith({ claimId: "claim_1", slug: "acme" });
    expect(screen.getByRole("alert")).toHaveTextContent("DNS lookup failed");
    expect(screen.getByRole("button", { name: "Check DNS" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows pending organization proof details in plain language", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [
        {
          id: "claim_1",
          entry_id: "e1",
          status: "pending",
          tier: 2,
          proofs: [
            {
              id: "proof_atproto",
              proof_type: "atproto",
              proof_status: "pending",
              proof_summary: "Linked ATProto handle acme.bsky.social.",
              metadata: {
                handle: "acme.bsky.social",
              },
              created_at: "2026-07-07T12:00:00Z",
            },
            {
              id: "proof_workspace",
              proof_type: "sso_admin",
              proof_status: "pending",
              proof_summary: "Workspace evidence is pending review.",
              metadata: {
                workspace_name: "Acme Team",
                workspace_role: "owner",
              },
              created_at: "2026-07-07T12:00:00Z",
            },
            {
              id: "proof_dns",
              proof_type: "domain_dns",
              proof_status: "pending",
              proof_summary: "Waiting for DNS record.",
              metadata: {
                domain: "acme.org",
                challenge_host: "_atlas-claim.acme.org",
                challenge_value: "atlas-profile-claim=token",
              },
              created_at: "2026-07-07T12:00:00Z",
            },
          ],
        },
      ],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    await renderOrganizationClaim();

    expect(screen.getByText("Connection details")).toBeInTheDocument();
    expect(screen.getByText("ATProto account")).toBeInTheDocument();
    expect(screen.getByText("acme.bsky.social")).toBeInTheDocument();
    expect(screen.getByText("Workspace role")).toBeInTheDocument();
    expect(screen.getByText("Acme Team - owner")).toBeInTheDocument();
    expect(screen.getByText("Organization domain")).toBeInTheDocument();
    expect(screen.getByText("acme.org")).toBeInTheDocument();
    expect(screen.getAllByText("Needs review")).toHaveLength(3);
  });

  it("renders pending button copy while mutations are running", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: true,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: true,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);

    await renderOrganizationClaim({ token: "tok_x" });
    expect(screen.getByRole("button", { name: "Verifying..." })).toBeDisabled();
    cleanupRenderedOrganizationClaim();

    await renderOrganizationClaim();
    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
  });

  it("uses the generic verify-failure copy when the rejection is not an Error", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue("plain"),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);

    await renderOrganizationClaim({ token: "tok_x" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm verification" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not verify token.");
  });
});
