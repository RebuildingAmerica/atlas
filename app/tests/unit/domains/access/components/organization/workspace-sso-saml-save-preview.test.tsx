// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WorkspaceSSOSamlSavePreview } from "@/domains/access/components/organization/workspace-sso-saml-save-preview";
import { buildSamlSavePreviewForm as buildForm } from "../../../../../fixtures/access/saml-save-preview";

describe("WorkspaceSSOSamlSavePreview", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the preview block and an enabled submit when every field is valid", () => {
    render(
      <WorkspaceSSOSamlSavePreview
        fallbackProviderId="saml-fallback"
        isPending={false}
        samlCertificateLooksValid={true}
        samlIssuerAllowed={true}
        samlSetupForm={buildForm()}
      />,
    );
    expect(screen.getByText(/Atlas will save:/)).toBeInTheDocument();
    expect(screen.getByText(/Domain: acme\.example/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save SAML provider" })).not.toBeDisabled();
  });

  it("falls back to the provided default provider ID when the form's value is whitespace", () => {
    render(
      <WorkspaceSSOSamlSavePreview
        fallbackProviderId="saml-fallback"
        isPending={false}
        samlCertificateLooksValid={true}
        samlIssuerAllowed={true}
        samlSetupForm={buildForm({ providerId: "   " })}
      />,
    );
    expect(screen.getByText(/Provider ID: saml-fallback/)).toBeInTheDocument();
  });

  it("hides the preview block and lists every missing field on the disabled save button", () => {
    render(
      <WorkspaceSSOSamlSavePreview
        fallbackProviderId="saml-fallback"
        isPending={false}
        samlCertificateLooksValid={false}
        samlIssuerAllowed={false}
        samlSetupForm={buildForm({
          domain: "",
          issuer: "",
          entryPoint: "",
          providerId: "",
        })}
      />,
    );
    expect(screen.queryByText(/Atlas will save:/)).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Save SAML provider" });
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toContain("workspace domain");
    expect(button.getAttribute("title")).toContain("issuer");
    expect(button.getAttribute("title")).toContain("sign-in URL");
    expect(button.getAttribute("title")).toContain("valid PEM certificate");
    expect(button.getAttribute("title")).toContain("provider ID");
  });

  it("flags an issuer that is not on the allowlist", () => {
    render(
      <WorkspaceSSOSamlSavePreview
        fallbackProviderId="saml-fallback"
        isPending={false}
        samlCertificateLooksValid={true}
        samlIssuerAllowed={false}
        samlSetupForm={buildForm()}
      />,
    );
    const button = screen.getByRole("button", { name: "Save SAML provider" });
    expect(button.getAttribute("title")).toContain("issuer on allowlist");
  });

  it("renders the pending submit copy while saving", () => {
    render(
      <WorkspaceSSOSamlSavePreview
        fallbackProviderId="saml-fallback"
        isPending={true}
        samlCertificateLooksValid={true}
        samlIssuerAllowed={true}
        samlSetupForm={buildForm()}
      />,
    );
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });
});
