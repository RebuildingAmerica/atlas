// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@rebuildingamerica/atlas-ui/ui/toast", () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

const parserMocks = vi.hoisted(() => ({
  parseSamlIdpMetadata: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-access/saml-metadata-parser", () => ({
  parseSamlIdpMetadata: parserMocks.parseSamlIdpMetadata,
}));

import { WorkspaceSSOSamlForm } from "@/domains/access/components/organization/workspace-sso-saml-form";
import { buildForm, buildSetup } from "./support";

describe("WorkspaceSSOSamlForm rendering", () => {
  afterEach(() => {
    cleanup();
    parserMocks.parseSamlIdpMetadata.mockReset();
    parserMocks.parseSamlIdpMetadata.mockImplementation((xml: string) => {
      const issuerMatch = /entityID="([^"]+)"/.exec(xml);
      const entryMatch = /Location="([^"]+)"/.exec(xml);
      const certMatch = /<X509Certificate>([^<]+)<\/X509Certificate>/.exec(xml);
      return {
        ok: true,
        metadata: {
          issuer: issuerMatch?.[1] ?? "",
          entryPoint: entryMatch?.[1] ?? "",
          certificate: certMatch
            ? `-----BEGIN CERTIFICATE-----\n${certMatch[1]}\n-----END CERTIFICATE-----`
            : "",
        },
      };
    });
  });

  it("renders the SAML configuration article with the copyable values", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm()}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText("SAML 2.0")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://atlas.test/acs")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://atlas.test/metadata.xml")).toBeInTheDocument();
  });

  it("hides the editing form for non-managers and shows the policy explanation", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization={false}
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm()}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByLabelText(/Workspace domain/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Only owners and admins can register enterprise providers/i),
    ).toBeInTheDocument();
  });

  it("confirms when the issuer host is on the allowlist", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm({ issuer: "https://accounts.google.com/saml" })}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/is on the allowlist/i)).toBeInTheDocument();
  });

  it("warns when the issuer host is not on the allowlist", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm({ issuer: "https://attacker.example/saml" })}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/is not on the allowlist/i)).toBeInTheDocument();
  });

  it("flags an issuer the URL parser cannot interpret", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm({ issuer: "not-a-url" })}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/\(unparseable\)/i)).toBeInTheDocument();
  });

  it("renders an empty allowlist warning with the operator-mailto link", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={[]}
        samlSetupForm={buildForm()}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/SAML registration is disabled/i)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Email Atlas operators/i });
    expect(links.length).toBeGreaterThan(0);
  });

  it("uses plural wording when the certificate has multiple body lines", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm({
          certificate:
            "-----BEGIN CERTIFICATE-----\nMIIBExample\nMIIBExample2\n-----END CERTIFICATE-----",
        })}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/2 body lines\)/i)).toBeInTheDocument();
  });

  it("uses singular wording when the certificate has exactly one body line", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm({
          certificate:
            "-----BEGIN CERTIFICATE-----\nMIIBExampleSingleLine\n-----END CERTIFICATE-----",
        })}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/1 body line\)/i)).toBeInTheDocument();
  });

  it("flags consumer mailbox domains", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm({ domain: "gmail.com" })}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/consumer mailbox host/i)).toBeInTheDocument();
  });

  it("renders an invalid certificate hint when the PEM cannot be parsed", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm({ certificate: "not a certificate" })}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const certificateField = screen.getByLabelText("X.509 certificate");

    expect(certificateField).toHaveAttribute("aria-invalid", "true");
    expect(certificateField).toHaveAccessibleDescription(
      /Atlas parses the certificate server-side/i,
    );
  });

  it("hides the workspace-domain suggestion when the setup omits one", () => {
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm()}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup({ workspaceDomainSuggestion: "" })}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByText(/Suggested from your signed-in email/i)).not.toBeInTheDocument();
  });
});
