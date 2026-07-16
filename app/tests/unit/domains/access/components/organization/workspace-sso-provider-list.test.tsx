// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const confirmMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock("@rebuildingamerica/atlas-ui/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirm: confirmMock,
  }),
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/toast", () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { WorkspaceSSOProviderList } from "@/domains/access/components/organization/workspace-sso-provider-list";
import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";

describe("WorkspaceSSOProviderList", () => {
  const providers = [
    {
      providerId: "oidc-1",
      providerType: "oidc",
      domain: "oidc.com",
      issuer: "iss",
      isPrimary: true,
      domainVerified: true,
      domainVerificationHost: "v-host",
      spMetadataUrl: "metadata",
      oidc: { discoveryEndpoint: "disc" },
    },
    {
      providerId: "saml-1",
      providerType: "saml",
      domain: "saml.com",
      issuer: "iss",
      isPrimary: false,
      domainVerified: false,
      domainVerificationHost: "v-host",
      spMetadataUrl: "metadata",
      saml: {
        callbackUrl: "acs",
        audience: "aud",
        entryPoint: "ep",
        certificate: { fingerprintSha256: "fp", errorMessage: "err" },
      },
    },
  ];

  const defaultProps = {
    canManageOrganization: true,
    domainVerificationTokens: { "saml-1": "token-xyz" },
    isPending: false,
    onDeleteProvider: vi.fn().mockResolvedValue(undefined),
    onRequestDomainVerification: vi.fn().mockResolvedValue(undefined),
    onRotateSAMLCertificate: vi.fn().mockResolvedValue(undefined),
    onSavePrimaryProvider: vi.fn().mockResolvedValue(undefined),
    onVerifyDomain: vi.fn().mockResolvedValue(undefined),
    organization: { sso: { providers } } as unknown as AtlasOrganizationDetails,
  };

  beforeEach(() => {
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the list of providers with their details", () => {
    render(<WorkspaceSSOProviderList {...defaultProps} />);

    expect(screen.getByText("oidc-1")).toBeInTheDocument();
    expect(screen.getByText("OIDC · oidc.com")).toBeInTheDocument();
    expect(screen.getByText(/Primary.*routes new sign-ins/i)).toBeInTheDocument();
    expect(screen.getByText("Domain verified")).toBeInTheDocument();

    expect(screen.getByText("saml-1")).toBeInTheDocument();
    expect(screen.getByText("SAML · saml.com")).toBeInTheDocument();
    expect(screen.getByText("Verification pending")).toBeInTheDocument();
  });

  it("shows SAML specific fields", () => {
    render(<WorkspaceSSOProviderList {...defaultProps} />);
    expect(screen.getByDisplayValue("acs")).toBeInTheDocument();
    expect(screen.getByDisplayValue("fp")).toBeInTheDocument();
    expect(screen.getByDisplayValue("err")).toBeInTheDocument();
  });

  it("shows DNS verification details for unverified providers", () => {
    render(<WorkspaceSSOProviderList {...defaultProps} />);
    expect(screen.getByText("DNS verification record")).toBeInTheDocument();
    expect(screen.getByDisplayValue("token-xyz")).toBeInTheDocument();
  });

  it("renders an empty state message when no providers exist", () => {
    render(
      <WorkspaceSSOProviderList
        {...defaultProps}
        organization={{ sso: { providers: [] } } as unknown as AtlasOrganizationDetails}
      />,
    );
    expect(screen.getByText(/No enterprise providers yet/i)).toBeInTheDocument();
  });

  it("handles SAML providers without audience or certificates", () => {
    const samlMinimal = {
      ...providers[1],
      saml: {
        callbackUrl: "acs",
        audience: null,
        entryPoint: "ep",
        certificate: { fingerprintSha256: null, errorMessage: null },
      },
    };
    render(
      <WorkspaceSSOProviderList
        {...defaultProps}
        organization={{ sso: { providers: [samlMinimal] } } as unknown as AtlasOrganizationDetails}
      />,
    );

    // Should fallback to spMetadataUrl for audience, so both metadata fields show "metadata"
    expect(screen.getAllByDisplayValue("metadata")).toHaveLength(2);
    expect(screen.queryByText(/Certificate fingerprint/i)).not.toBeInTheDocument();
  });

  it("hides management buttons for non-managers", () => {
    render(<WorkspaceSSOProviderList {...defaultProps} canManageOrganization={false} />);
    expect(screen.queryByText("Make primary")).not.toBeInTheDocument();
    expect(screen.queryByText("Remove provider")).not.toBeInTheDocument();
  });

  it("renders the secondary-but-ready badge for verified non-primary providers", () => {
    const verifiedSecondary = {
      ...providers[0],
      providerId: "secondary",
      isPrimary: false,
      domainVerified: true,
    };
    const ssoOrg = {
      sso: { providers: [verifiedSecondary], primaryHistory: [] },
    } as unknown as AtlasOrganizationDetails;
    render(<WorkspaceSSOProviderList {...defaultProps} organization={ssoOrg} />);
    expect(screen.getByText(/Secondary.*ready to promote/i)).toBeInTheDocument();
  });

  it("renders the primary-history disclosure when entries exist", () => {
    const ssoOrg = {
      sso: {
        providers,
        primaryHistory: [
          {
            changedAt: "2026-04-01T00:00:00.000Z",
            changedByEmail: "owner@atlas.test",
            providerId: "saml-1",
          },
        ],
      },
    } as unknown as AtlasOrganizationDetails;
    render(<WorkspaceSSOProviderList {...defaultProps} organization={ssoOrg} />);
    expect(screen.getByText("Primary-provider change history")).toBeInTheDocument();
    expect(screen.getByText(/owner@atlas\.test/i)).toBeInTheDocument();
  });

  it("triggers action handlers", async () => {
    render(<WorkspaceSSOProviderList {...defaultProps} />);

    fireEvent.click(screen.getByText("Generate new verification token"));
    await Promise.resolve();
    await Promise.resolve();
    expect(defaultProps.onRequestDomainVerification).toHaveBeenCalledWith("saml-1");

    fireEvent.click(screen.getByText("Check now"));
    await Promise.resolve();
    expect(defaultProps.onVerifyDomain).toHaveBeenCalledWith("saml-1");

    fireEvent.click(screen.getByText("Make primary"));
    await Promise.resolve();
    await Promise.resolve();
    expect(defaultProps.onSavePrimaryProvider).toHaveBeenCalledWith("saml-1");

    const removeButtons = screen.getAllByText("Remove provider");
    const firstRemoveButton = removeButtons[0];
    if (!firstRemoveButton) throw new Error("Expected at least one remove button");
    fireEvent.click(firstRemoveButton);
    expect(defaultProps.onDeleteProvider).toHaveBeenCalledWith("oidc-1");
  });

  it("disables every SAML provider when the bulk action is confirmed", async () => {
    render(<WorkspaceSSOProviderList {...defaultProps} />);
    const summary = screen.getByText("Incident response");
    fireEvent.click(summary);

    fireEvent.click(screen.getByText("Disable all SAML providers"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(defaultProps.onDeleteProvider).toHaveBeenCalledWith("saml-1");
  });

  it("swallows individual onDeleteProvider rejections during a bulk disable", async () => {
    const onDeleteProvider = vi.fn().mockRejectedValue(new Error("partial fail"));
    render(<WorkspaceSSOProviderList {...defaultProps} onDeleteProvider={onDeleteProvider} />);
    fireEvent.click(screen.getByText("Incident response"));

    await act(async () => {
      fireEvent.click(screen.getByText("Disable all SAML providers"));
      await Promise.resolve();
      await Promise.resolve();
    });
    // Failure is swallowed by the inner .catch() so no test-runner unhandled
    // rejections fire; the call still happened.
    expect(onDeleteProvider).toHaveBeenCalledWith("saml-1");
  });

  it("skips bulk disable when confirmation is rejected", async () => {
    confirmMock.mockResolvedValueOnce(false);
    render(<WorkspaceSSOProviderList {...defaultProps} />);
    fireEvent.click(screen.getByText("Incident response"));
    fireEvent.click(screen.getByText("Disable all SAML providers"));
    await Promise.resolve();
    await Promise.resolve();
    expect(defaultProps.onDeleteProvider).not.toHaveBeenCalled();
  });

  it("aborts make-primary when the operator declines", async () => {
    confirmMock.mockResolvedValueOnce(false);
    render(<WorkspaceSSOProviderList {...defaultProps} />);
    fireEvent.click(screen.getByText("Make primary"));
    await Promise.resolve();
    await Promise.resolve();
    expect(defaultProps.onSavePrimaryProvider).not.toHaveBeenCalled();
  });

  it("aborts a token replacement when the operator declines", async () => {
    confirmMock.mockResolvedValueOnce(false);
    render(<WorkspaceSSOProviderList {...defaultProps} />);
    fireEvent.click(screen.getByText("Generate new verification token"));
    await Promise.resolve();
    await Promise.resolve();
    expect(defaultProps.onRequestDomainVerification).not.toHaveBeenCalled();
  });

  it("renders a verification error when verifyDomain rejects", async () => {
    const onVerifyDomain = vi.fn().mockRejectedValue(new Error("DNS not propagated"));
    render(<WorkspaceSSOProviderList {...defaultProps} onVerifyDomain={onVerifyDomain} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Check now"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/DNS not propagated/i)).toBeInTheDocument();
    });
  });

  it("falls back to a generic error when verifyDomain rejects with a non-Error", async () => {
    const onVerifyDomain = vi.fn().mockRejectedValue("not-an-error");
    render(<WorkspaceSSOProviderList {...defaultProps} onVerifyDomain={onVerifyDomain} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Check now"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/Atlas could not verify the TXT record/i)).toBeInTheDocument();
    });
  });

  it("does not render incident response disclosure when there are no SAML providers", () => {
    const oidcOnly = providers.filter((provider) => provider.providerType === "oidc");
    render(
      <WorkspaceSSOProviderList
        {...defaultProps}
        organization={{ sso: { providers: oidcOnly } } as unknown as AtlasOrganizationDetails}
      />,
    );
    expect(screen.queryByText("Incident response")).not.toBeInTheDocument();
  });

  it("issues a fresh token without confirmation when none is currently stored", async () => {
    render(<WorkspaceSSOProviderList {...defaultProps} domainVerificationTokens={{}} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Generate verification token"));
      await Promise.resolve();
    });

    expect(defaultProps.onRequestDomainVerification).toHaveBeenCalledWith("saml-1");
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("labels SAML providers with signed AuthnRequests when configured", () => {
    const samlSigned = {
      ...providers[1],
      saml: {
        callbackUrl: "acs",
        audience: "aud",
        entryPoint: "ep",
        authnRequestsSigned: true,
        certificate: { fingerprintSha256: "fp", errorMessage: null },
      },
    };
    render(
      <WorkspaceSSOProviderList
        {...defaultProps}
        organization={{ sso: { providers: [samlSigned] } } as unknown as AtlasOrganizationDetails}
      />,
    );
    expect(screen.getByText("Signed AuthnRequests")).toBeInTheDocument();
  });

  it("renders the certificate-expiry block when notAfter is present", () => {
    const samlWithExpiry = {
      ...providers[1],
      saml: {
        callbackUrl: "acs",
        audience: "aud",
        entryPoint: "ep",
        certificate: {
          fingerprintSha256: "fp",
          errorMessage: null,
          notAfter: "2030-01-01T00:00:00Z",
          notBefore: "2026-01-01T00:00:00Z",
        },
      },
    };
    render(
      <WorkspaceSSOProviderList
        {...defaultProps}
        organization={
          { sso: { providers: [samlWithExpiry] } } as unknown as AtlasOrganizationDetails
        }
      />,
    );
    expect(screen.getByDisplayValue(/2030-01-01/)).toBeInTheDocument();
  });

  it("surfaces the timed-out banner once the verification poll exits", () => {
    render(
      <WorkspaceSSOProviderList {...defaultProps} verificationTimedOutProviderIds={["saml-1"]} />,
    );
    expect(screen.getByText(/Atlas stopped polling DNS after 10 minutes/i)).toBeInTheDocument();
  });

  it("renders history entries that lack a provider id or operator email", () => {
    const ssoOrg = {
      sso: {
        providers,
        primaryHistory: [
          {
            changedAt: "2026-04-01T00:00:00.000Z",
            changedByEmail: null,
            providerId: null,
          },
        ],
      },
    } as unknown as AtlasOrganizationDetails;
    render(<WorkspaceSSOProviderList {...defaultProps} organization={ssoOrg} />);
    expect(screen.getByText(/\(no primary\)/i)).toBeInTheDocument();
  });
});
