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

describe("WorkspaceSSOSamlForm submission", () => {
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
});
