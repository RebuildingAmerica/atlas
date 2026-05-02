// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrganizationPageSSOActions } from "@/domains/access/components/organization/use-organization-page-sso-actions";
import type { OrganizationPageForms } from "@/domains/access/components/organization/use-organization-page-forms";
import type {
  WorkspaceOIDCSetupFormState,
  WorkspaceSAMLSetupFormState,
} from "@/domains/access/components/organization/organization-page-controller";

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  registerWorkspaceGoogleOIDCProvider: vi.fn(),
  registerWorkspaceSAMLProvider: vi.fn(),
  requestWorkspaceSSODomainVerification: vi.fn(),
  rotateWorkspaceSAMLCertificate: vi.fn(),
  setWorkspacePrimarySSOProvider: vi.fn(),
  verifyWorkspaceSSODomain: vi.fn(),
  deleteWorkspaceSSOProvider: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
}));

vi.mock("@/domains/access/sso.functions", () => ({
  registerWorkspaceGoogleOIDCProvider: mocks.registerWorkspaceGoogleOIDCProvider,
  registerWorkspaceSAMLProvider: mocks.registerWorkspaceSAMLProvider,
  requestWorkspaceSSODomainVerification: mocks.requestWorkspaceSSODomainVerification,
  rotateWorkspaceSAMLCertificate: mocks.rotateWorkspaceSAMLCertificate,
  setWorkspacePrimarySSOProvider: mocks.setWorkspacePrimarySSOProvider,
  verifyWorkspaceSSODomain: mocks.verifyWorkspaceSSODomain,
  deleteWorkspaceSSOProvider: mocks.deleteWorkspaceSSOProvider,
}));

describe("useOrganizationPageSSOActions", () => {
  const feedback = {
    setErrorMessage: vi.fn(),
    setFlashMessage: vi.fn(),
  };
  const forms = {
    oidcSetupForm: {
      domain: "d",
      providerId: "p",
      clientId: "c",
      clientSecret: "s",
      setAsPrimary: true,
    },
    setOidcSetupForm: vi.fn(),
    samlSetupForm: {},
    setSamlSetupForm: vi.fn(),
  };
  const refreshWorkspaceData = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementation for useMutation
    mocks.useMutation.mockImplementation(
      ({ mutationFn }: { mutationFn: (args: unknown) => unknown }) => ({
        mutateAsync: vi.fn().mockImplementation((args: unknown) => mutationFn(args)),
        isPending: false,
      }),
    );
  });

  it("handles OIDC form submission", async () => {
    mocks.registerWorkspaceGoogleOIDCProvider.mockResolvedValue({
      domainVerificationToken: "token_123",
      providerId: "google-oidc",
    });

    const { result } = renderHook(() =>
      useOrganizationPageSSOActions({
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onOidcFormSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent<HTMLFormElement>);
    });

    expect(mocks.registerWorkspaceGoogleOIDCProvider).toHaveBeenCalled();
    expect(result.current.domainVerificationTokens["google-oidc"]).toBe("token_123");
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Google Workspace OIDC saved.");

    // The OIDC submit handler should ask the form to clear client credentials.
    const oidcCalls = forms.setOidcSetupForm.mock.calls as unknown as readonly [
      (current: WorkspaceOIDCSetupFormState) => WorkspaceOIDCSetupFormState,
    ][];
    const setOidcUpdater = oidcCalls[0]?.[0];
    if (typeof setOidcUpdater !== "function") throw new Error("Expected updater callback");
    expect(
      setOidcUpdater({
        domain: "d",
        providerId: "p",
        clientId: "old",
        clientSecret: "old",
        setAsPrimary: true,
      }),
    ).toEqual({ domain: "d", providerId: "p", clientId: "", clientSecret: "", setAsPrimary: true });
  });

  it("handles provider deletion", async () => {
    mocks.deleteWorkspaceSSOProvider.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageSSOActions({
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onDeleteSSOProvider("google-oidc");
    });

    expect(mocks.deleteWorkspaceSSOProvider).toHaveBeenCalled();
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Enterprise provider removed.");
  });

  it("handles SAML form submission", async () => {
    mocks.registerWorkspaceSAMLProvider.mockResolvedValue({
      domainVerificationToken: "saml_token",
      providerId: "saml-1",
    });

    const { result } = renderHook(() =>
      useOrganizationPageSSOActions({
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onSamlFormSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent<HTMLFormElement>);
    });

    expect(mocks.registerWorkspaceSAMLProvider).toHaveBeenCalled();
    expect(result.current.domainVerificationTokens["saml-1"]).toBe("saml_token");
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Google Workspace SAML saved.");

    // The SAML submit handler should clear certificate/entryPoint/issuer.
    const samlCalls = forms.setSamlSetupForm.mock.calls as unknown as readonly [
      (current: WorkspaceSAMLSetupFormState) => WorkspaceSAMLSetupFormState,
    ][];
    const setSamlUpdater = samlCalls[0]?.[0];
    if (typeof setSamlUpdater !== "function") throw new Error("Expected updater callback");
    expect(
      setSamlUpdater({
        certificate: "old",
        domain: "d",
        entryPoint: "old",
        issuer: "old",
        providerId: "p",
        setAsPrimary: true,
      }),
    ).toEqual({
      certificate: "",
      domain: "d",
      entryPoint: "",
      issuer: "",
      providerId: "p",
      setAsPrimary: true,
    });
  });

  it("saves a primary provider", async () => {
    mocks.setWorkspacePrimarySSOProvider.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageSSOActions({
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onSavePrimaryProvider("google-oidc");
    });

    expect(mocks.setWorkspacePrimarySSOProvider).toHaveBeenCalledWith({
      data: { providerId: "google-oidc" },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Primary provider updated.");
  });

  it("requests a fresh domain verification token", async () => {
    mocks.requestWorkspaceSSODomainVerification.mockResolvedValue({
      domainVerificationToken: "fresh_token",
    });

    const { result } = renderHook(() =>
      useOrganizationPageSSOActions({
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onRequestDomainVerification("google-oidc");
    });

    expect(result.current.domainVerificationTokens["google-oidc"]).toBe("fresh_token");
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Fresh verification token issued.");
  });

  it("verifies a provider domain and clears its stored token", async () => {
    mocks.verifyWorkspaceSSODomain.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageSSOActions({
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    // Seed a token first.
    await act(async () => {
      await result.current.onRequestDomainVerification("google-oidc");
    });
    expect(result.current.domainVerificationTokens["google-oidc"]).toBeDefined();

    await act(async () => {
      await result.current.onVerifyDomain("google-oidc");
    });

    expect(result.current.domainVerificationTokens["google-oidc"]).toBeUndefined();
    expect(feedback.setFlashMessage).toHaveBeenCalledWith("Domain verified.");
  });

  it("rotates a SAML certificate", async () => {
    mocks.rotateWorkspaceSAMLCertificate.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useOrganizationPageSSOActions({
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await result.current.onRotateSAMLCertificate("saml-1", "-----BEGIN CERTIFICATE-----");
    });

    expect(mocks.rotateWorkspaceSAMLCertificate).toHaveBeenCalledWith({
      data: { certificate: "-----BEGIN CERTIFICATE-----", providerId: "saml-1" },
    });
    expect(feedback.setFlashMessage).toHaveBeenCalledWith(
      "SAML certificate rotated. Domain verification was preserved.",
    );
  });

  it("aggregates pending state across SSO mutations", () => {
    let oidcPending = false;
    mocks.useMutation.mockImplementation(
      ({ mutationFn }: { mutationFn: (args: unknown) => unknown }) => {
        // Mark only the first registered mutation as pending.
        const isPending = !oidcPending;
        oidcPending = true;
        return {
          mutateAsync: vi.fn().mockImplementation((args: unknown) => mutationFn(args)),
          isPending,
        };
      },
    );

    const { result } = renderHook(() =>
      useOrganizationPageSSOActions({
        feedback,
        forms: forms as unknown as OrganizationPageForms,
        refreshWorkspaceData,
      }),
    );

    expect(result.current.ssoMutationPending).toBe(true);
  });
});
