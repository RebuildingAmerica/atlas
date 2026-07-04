// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/platform/ui/toast", () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

const parserMocks = vi.hoisted(() => ({
  parseSamlIdpMetadata: vi.fn(),
}));

vi.mock("@/domains/access/saml-metadata-parser", () => ({
  parseSamlIdpMetadata: parserMocks.parseSamlIdpMetadata,
}));

import { WorkspaceSSOSamlForm } from "@/domains/access/components/organization/workspace-sso-saml-form";
import type { AtlasWorkspaceSSOSetupValues } from "@/domains/access/organization-sso-defaults";
import type { WorkspaceSAMLSetupFormState } from "@/domains/access/components/organization/organization-page-controller";

interface SetupOverrides {
  workspaceDomainSuggestion?: string;
}

function buildSetup(overrides: SetupOverrides = {}): AtlasWorkspaceSSOSetupValues {
  return {
    dnsTokenPrefix: "_better-auth-token",
    googleWorkspaceIssuer: "https://accounts.google.com",
    googleWorkspaceScopes: ["openid", "email", "profile"],
    oidcProviderIdSuggestion: "oidc-suggestion",
    oidcRedirectUrl: "https://atlas.test/callback",
    samlAcsUrl: "https://atlas.test/acs",
    samlEntityId: "https://atlas.test/metadata",
    samlMetadataUrl: "https://atlas.test/metadata.xml",
    samlProviderIdSuggestion: "saml-suggestion",
    workspaceDomainSuggestion: "atlas.test",
    ...overrides,
  };
}

function buildForm(
  overrides: Partial<WorkspaceSAMLSetupFormState> = {},
): WorkspaceSAMLSetupFormState {
  return {
    certificate: "",
    domain: "",
    entryPoint: "",
    issuer: "",
    providerId: "",
    setAsPrimary: false,
    ...overrides,
  };
}

describe("WorkspaceSSOSamlForm", () => {
  afterEach(() => {
    cleanup();
    parserMocks.parseSamlIdpMetadata.mockReset();
    parserMocks.parseSamlIdpMetadata.mockImplementation((xml: string) => {
      // Default delegate to a simple parser that pulls issuer/entryPoint/cert
      // from inline strings inside the test XML payloads.
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

  it("forwards domain, issuer, sign-in URL, certificate, and provider id edits", () => {
    const setSamlSetupForm = vi.fn();
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm()}
        setSamlSetupForm={setSamlSetupForm}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Workspace domain/i), {
      target: { value: "atlas.test" },
    });
    fireEvent.change(screen.getByLabelText(/Identity provider issuer/i), {
      target: { value: "https://accounts.google.com/o/saml2?idpid=abc" },
    });
    fireEvent.change(screen.getByLabelText(/Identity provider sign-in URL/i), {
      target: { value: "https://accounts.google.com/o/saml2/idp" },
    });
    fireEvent.change(screen.getByLabelText(/X.509 certificate/i), {
      target: { value: "-----BEGIN CERTIFICATE-----\nbody\n-----END CERTIFICATE-----" },
    });
    fireEvent.change(screen.getByLabelText("Provider ID"), { target: { value: "manual-id" } });

    expect(setSamlSetupForm).toHaveBeenCalledTimes(5);

    // Apply each updater against an empty state and verify it sets the right field.
    const updaters = setSamlSetupForm.mock.calls.map(
      (call) => call[0] as (s: WorkspaceSAMLSetupFormState) => WorkspaceSAMLSetupFormState,
    );
    const empty = buildForm();
    expect(updaters[0]?.(empty).domain).toBe("atlas.test");
    expect(updaters[1]?.(empty).issuer).toBe("https://accounts.google.com/o/saml2?idpid=abc");
    expect(updaters[2]?.(empty).entryPoint).toBe("https://accounts.google.com/o/saml2/idp");
    expect(updaters[3]?.(empty).certificate).toContain("BEGIN CERTIFICATE");
    expect(updaters[4]?.(empty).providerId).toBe("manual-id");
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

  it("leaves form fields untouched when the metadata document is missing values", () => {
    const setSamlSetupForm = vi.fn();
    parserMocks.parseSamlIdpMetadata.mockReturnValueOnce({
      ok: true,
      metadata: { issuer: "", entryPoint: "", certificate: "" },
    });
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm()}
        setSamlSetupForm={setSamlSetupForm}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const xmlField = screen.getByLabelText(/IdP metadata XML/i);
    fireEvent.change(xmlField, { target: { value: "<EntityDescriptor></EntityDescriptor>" } });
    fireEvent.click(screen.getByText("Prefill from metadata"));

    expect(setSamlSetupForm).toHaveBeenCalledTimes(1);
    const updater = setSamlSetupForm.mock.calls[0]?.[0] as (
      s: WorkspaceSAMLSetupFormState,
    ) => WorkspaceSAMLSetupFormState;
    const previous = buildForm({ issuer: "kept", entryPoint: "kept-ep", certificate: "kept-cert" });
    const next = updater(previous);
    // None of the empty metadata fields should overwrite existing form values.
    expect(next.issuer).toBe("kept");
    expect(next.entryPoint).toBe("kept-ep");
    expect(next.certificate).toBe("kept-cert");
  });

  it("describes which fields the metadata paste fills and applies them through setSamlSetupForm", () => {
    const setSamlSetupForm = vi.fn();
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm()}
        setSamlSetupForm={setSamlSetupForm}
        setup={buildSetup()}
        onSamlSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const xmlField = screen.getByLabelText(/IdP metadata XML/i);
    fireEvent.change(xmlField, {
      target: {
        value: `<?xml version="1.0"?>
<EntityDescriptor entityID="https://accounts.google.com/o/saml2?idpid=abc" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>MIIBaseCertBase64</X509Certificate></X509Data></KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://accounts.google.com/o/saml2/idp"/>
  </IDPSSODescriptor>
</EntityDescriptor>`,
      },
    });
    fireEvent.click(screen.getByText("Prefill from metadata"));

    expect(setSamlSetupForm).toHaveBeenCalled();
    const updater = setSamlSetupForm.mock.calls[0]?.[0] as (
      s: WorkspaceSAMLSetupFormState,
    ) => WorkspaceSAMLSetupFormState;
    const next = updater(buildForm());
    expect(next.issuer).toBe("https://accounts.google.com/o/saml2?idpid=abc");
    expect(next.entryPoint).toBe("https://accounts.google.com/o/saml2/idp");
    expect(next.certificate).toContain("BEGIN CERTIFICATE");
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

  it("invokes onSamlSubmit when the form is submitted", () => {
    const onSamlSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceSSOSamlForm
        canManageOrganization
        isPending={false}
        samlAllowedIssuerOrigins={["https://accounts.google.com"]}
        samlSetupForm={buildForm({
          certificate: "-----BEGIN CERTIFICATE-----\nbody\n-----END CERTIFICATE-----",
          domain: "atlas.test",
          entryPoint: "https://accounts.google.com/o/saml2/idp",
          issuer: "https://accounts.google.com/o/saml2?idpid=abc",
          providerId: "saml-id",
        })}
        setSamlSetupForm={vi.fn()}
        setup={buildSetup()}
        onSamlSubmit={onSamlSubmit}
      />,
    );

    const form = screen.getByRole("button", { name: /Save SAML provider/i }).closest("form");
    if (!form) throw new Error("Expected SAML setup form");
    fireEvent.submit(form);
    expect(onSamlSubmit).toHaveBeenCalled();
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
