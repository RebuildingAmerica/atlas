// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("@/domains/access/saml-metadata-parser", () => ({
  parseSamlIdpMetadata: parserMocks.parseSamlIdpMetadata,
}));

import { WorkspaceSSOSamlForm } from "@/domains/access/components/organization/workspace-sso-saml-form";
import { buildForm, buildSetup } from "./support";
import type { WorkspaceSAMLSetupFormState } from "@/domains/access/components/organization/organization-page-controller";

describe("WorkspaceSSOSamlForm metadata", () => {
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
});
