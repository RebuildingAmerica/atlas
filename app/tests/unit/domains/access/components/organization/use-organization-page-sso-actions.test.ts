// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrganizationPageSSOActions } from "@/domains/access/components/organization/use-organization-page-sso-actions";
import type { OrganizationPageForms } from "@/domains/access/components/organization/use-organization-page-forms";

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  registerWorkspaceGoogleOIDCProvider: vi.fn(),
  registerWorkspaceSAMLProvider: vi.fn(),
  requestWorkspaceSSODomainVerification: vi.fn(),
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
});
