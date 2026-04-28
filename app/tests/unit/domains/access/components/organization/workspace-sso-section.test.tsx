// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkspaceSSOSection } from "@/domains/access/components/organization/workspace-sso-section";
import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";

describe("WorkspaceSSOSection", () => {
  const organization = {
    sso: {
      providers: [],
      setup: {
        googleWorkspaceIssuer: "https://accounts.google.com",
        googleWorkspaceScopes: ["openid", "email"],
        oidcProviderIdSuggestion: "google",
        oidcRedirectUrl: "https://atlas.test/callback",
        samlAcsUrl: "https://atlas.test/acs",
        samlEntityId: "https://atlas.test/metadata",
        samlMetadataUrl: "https://atlas.test/metadata.xml",
        samlProviderIdSuggestion: "saml",
        workspaceDomainSuggestion: "atlas.test",
      },
    },
  };

  const defaultProps = {
    canManageOrganization: true,
    domainVerificationTokens: {},
    isPending: false,
    oidcSetupForm: {
      domain: "",
      providerId: "",
      clientId: "",
      clientSecret: "",
      setAsPrimary: false,
    },
    organization: organization as unknown as AtlasOrganizationDetails,
    samlAllowedIssuerOrigins: ["https://accounts.google.com"] as readonly string[],
    samlSetupForm: {
      domain: "",
      providerId: "",
      issuer: "",
      entryPoint: "",
      certificate: "",
      setAsPrimary: false,
    },
    setOidcSetupForm: vi.fn(),
    setSamlSetupForm: vi.fn(),
    onDeleteProvider: vi.fn(),
    onOidcSubmit: vi.fn((e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      return Promise.resolve();
    }),
    onRequestDomainVerification: vi.fn(),
    onSamlSubmit: vi.fn((e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      return Promise.resolve();
    }),
    onSavePrimaryProvider: vi.fn(),
    onVerifyDomain: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  it("renders the SSO management surface", () => {
    render(<WorkspaceSSOSection {...defaultProps} />);
    expect(screen.getByText("Enterprise SSO")).toBeInTheDocument();
    expect(screen.getByText("Google Workspace OIDC")).toBeInTheDocument();
    expect(screen.getByText("SAML 2.0")).toBeInTheDocument();
    expect(screen.getAllByText("atlas.test")).toHaveLength(2); // In hints
  });

  it("hides domain hints when no suggestion is available", () => {
    const noHintOrg = {
      ...organization,
      sso: {
        ...organization.sso,
        setup: { ...organization.sso.setup, workspaceDomainSuggestion: null },
      },
    };
    render(
      <WorkspaceSSOSection
        {...defaultProps}
        organization={noHintOrg as unknown as AtlasOrganizationDetails}
      />,
    );
    expect(screen.queryByText(/Suggested from your signed-in email/i)).not.toBeInTheDocument();
  });

  it("triggers input handlers", () => {
    render(<WorkspaceSSOSection {...defaultProps} />);

    // OIDC Domain input
    const domainInputs = screen.getAllByLabelText(/Workspace domain/i);
    const oidcDomainInput = domainInputs[0];
    if (!oidcDomainInput) throw new Error("Expected OIDC domain input");
    fireEvent.change(oidcDomainInput, { target: { value: "new.com" } });
    expect(defaultProps.setOidcSetupForm).toHaveBeenCalled();

    // SAML certificate textarea
    const samlCertInput = screen.getByLabelText(/X.509 certificate/i);
    fireEvent.change(samlCertInput, { target: { value: "-----BEGIN CERTIFICATE-----" } });
    expect(defaultProps.setSamlSetupForm).toHaveBeenCalled();
  });

  it("triggers OIDC submission when form is filled", () => {
    const oidcProps = {
      ...defaultProps,
      oidcSetupForm: {
        domain: "atlas.test",
        providerId: "google",
        clientId: "c",
        clientSecret: "s",
        setAsPrimary: false,
      },
    };
    render(<WorkspaceSSOSection {...oidcProps} />);
    fireEvent.click(screen.getByText("Save Google Workspace OIDC"));
    expect(defaultProps.onOidcSubmit).toHaveBeenCalled();
  });

  it("triggers SAML submission when form is filled with an allowlisted issuer", () => {
    const samlProps = {
      ...defaultProps,
      samlSetupForm: {
        domain: "atlas.test",
        providerId: "saml",
        issuer: "https://accounts.google.com/o/saml2?idpid=abc",
        entryPoint: "https://accounts.google.com/o/saml2/idp",
        certificate: "-----BEGIN CERTIFICATE-----\nMIIBExampleBytes\n-----END CERTIFICATE-----",
        setAsPrimary: false,
      },
    };
    render(<WorkspaceSSOSection {...samlProps} />);
    fireEvent.click(screen.getByText("Save SAML provider"));
    expect(defaultProps.onSamlSubmit).toHaveBeenCalled();
  });

  it("blocks SAML submission when the issuer is not on the allowlist", () => {
    const samlProps = {
      ...defaultProps,
      samlSetupForm: {
        domain: "atlas.test",
        providerId: "saml",
        issuer: "https://idp.attacker.example",
        entryPoint: "https://idp.attacker.example/sso",
        certificate: "-----BEGIN CERTIFICATE-----\nMIIBExampleBytes\n-----END CERTIFICATE-----",
        setAsPrimary: false,
      },
    };
    render(<WorkspaceSSOSection {...samlProps} />);
    const saveButton = screen.getByText("Save SAML provider");
    expect(saveButton).toBeDisabled();
  });

  it("warns when the SAML issuer allowlist is empty", () => {
    render(<WorkspaceSSOSection {...defaultProps} samlAllowedIssuerOrigins={[]} />);
    expect(
      screen.getByText(/SAML registration is disabled for this deployment/i),
    ).toBeInTheDocument();
  });
});
