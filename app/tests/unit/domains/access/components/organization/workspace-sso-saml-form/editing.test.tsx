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

vi.mock("@rebuildingamerica/atlas-access/saml-metadata-parser", () => ({
  parseSamlIdpMetadata: parserMocks.parseSamlIdpMetadata,
}));

import { WorkspaceSSOSamlForm } from "@/domains/access/components/organization/workspace-sso-saml-form";
import { buildForm, buildSetup } from "./support";
import type { WorkspaceSAMLSetupFormState } from "@/domains/access/components/organization/organization-page-controller";

describe("WorkspaceSSOSamlForm editing", () => {
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
});
