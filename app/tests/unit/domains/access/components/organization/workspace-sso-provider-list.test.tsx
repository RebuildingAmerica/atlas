// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/platform/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirm: () => Promise.resolve(true),
  }),
}));

vi.mock("@/platform/ui/toast", () => ({
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
    onDeleteProvider: vi.fn(),
    onRequestDomainVerification: vi.fn(),
    onRotateSAMLCertificate: vi.fn(),
    onSavePrimaryProvider: vi.fn(),
    onVerifyDomain: vi.fn(),
    organization: { sso: { providers } } as unknown as AtlasOrganizationDetails,
  };

  afterEach(() => {
    cleanup();
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
});
