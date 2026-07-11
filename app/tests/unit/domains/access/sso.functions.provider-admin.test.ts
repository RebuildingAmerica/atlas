import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSsoFunctionsAuthApi,
  getSsoFunctionsBrowserSessionHeaders,
  getSsoFunctionsMocks,
  resetSsoFunctionsTestBed,
} from "../../../helpers/access/sso-functions-test-bed";
import { createStoredWorkspaceIdentityFixture } from "../../../fixtures/access/sso";
import {
  createServerFnStub,
  createServerOnlyFnStub,
  type ServerFnExecutionResponse,
} from "../../../helpers/server-fn-stub";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: createServerFnStub(),
  createServerOnlyFn: createServerOnlyFnStub(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: getSsoFunctionsMocks().ensureAuthReady,
}));

vi.mock("@/domains/access/server/request-headers", () => ({
  getBrowserSessionHeaders: getSsoFunctionsMocks().getBrowserSessionHeaders,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: getSsoFunctionsMocks().getAuthRuntimeConfig,
  getSamlAllowedIssuerOrigins: getSsoFunctionsMocks().getSamlAllowedIssuerOrigins,
  isAllowedSamlIssuer: getSsoFunctionsMocks().isAllowedSamlIssuer,
}));

vi.mock("@/domains/access/organization-server-helpers", () => ({
  loadOrganizationRequestContext: getSsoFunctionsMocks().loadOrganizationRequestContext,
  requireManagedTeamWorkspace: getSsoFunctionsMocks().requireManagedTeamWorkspace,
}));

vi.mock("@/domains/access/server/sso-provider-store", () => ({
  listStoredWorkspaceSSOProviders: getSsoFunctionsMocks().listStoredWorkspaceSSOProviders,
  loadStoredWorkspaceIdentity: getSsoFunctionsMocks().loadStoredWorkspaceIdentity,
}));

describe("sso.functions provider management", () => {
  const browserSessionHeaders = getSsoFunctionsBrowserSessionHeaders();
  let authApi = getSsoFunctionsAuthApi();

  beforeEach(() => {
    resetSsoFunctionsTestBed();
    authApi = getSsoFunctionsAuthApi();
  });

  it("sets a workspace primary SSO provider", async () => {
    const { setWorkspacePrimarySSOProvider } = await import("@/domains/access/sso.functions");
    const response = (await setWorkspacePrimarySSOProvider.__executeServer({
      method: "POST",
      data: {
        providerId: "google-oidc",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.updateOrganization).toHaveBeenCalled();
    expect(response.result).toEqual({ ok: true });
  });

  it("verifies a workspace SSO domain", async () => {
    const { verifyWorkspaceSSODomain } = await import("@/domains/access/sso.functions");
    const response = (await verifyWorkspaceSSODomain.__executeServer({
      method: "POST",
      data: {
        providerId: "google-oidc",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.verifyDomain).toHaveBeenCalledWith({
      body: { providerId: "google-oidc" },
      headers: browserSessionHeaders,
    });
    expect(response.result).toEqual({ ok: true });
  });

  it("requests a fresh domain verification token for one provider", async () => {
    const { requestWorkspaceSSODomainVerification } =
      await import("@/domains/access/sso.functions");
    const response = (await requestWorkspaceSSODomainVerification.__executeServer({
      method: "POST",
      data: {
        providerId: "atlas-team-google-workspace-saml",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.requestDomainVerification).toHaveBeenCalledWith({
      body: {
        providerId: "atlas-team-google-workspace-saml",
      },
      headers: browserSessionHeaders,
    });
    expect(response.result).toEqual({
      domainVerificationToken: "token_456",
    });
  });

  it("deletes a provider and clears the primary marker when it was active", async () => {
    getSsoFunctionsMocks().loadStoredWorkspaceIdentity.mockReturnValue(
      createStoredWorkspaceIdentityFixture({
        primaryProviderId: "atlas-team-google-workspace-saml",
      }),
    );

    const { deleteWorkspaceSSOProvider } = await import("@/domains/access/sso.functions");
    const response = (await deleteWorkspaceSSOProvider.__executeServer({
      method: "POST",
      data: {
        providerId: "atlas-team-google-workspace-saml",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.deleteSSOProvider).toHaveBeenCalledWith({
      body: {
        providerId: "atlas-team-google-workspace-saml",
      },
      headers: browserSessionHeaders,
    });
    expect(authApi.updateOrganization).toHaveBeenCalledWith({
      body: {
        data: {
          metadata: {
            ssoPrimaryProviderId: null,
            stripeCustomerId: null,
            workspaceType: "team",
          },
        },
        organizationId: "org_team",
      },
      headers: browserSessionHeaders,
    });
  });

  it("returns the operator-managed SAML issuer allowlist", async () => {
    getSsoFunctionsMocks().getSamlAllowedIssuerOrigins.mockReturnValue([
      "https://accounts.google.com",
      "https://login.microsoftonline.com",
    ]);

    const { getWorkspaceSAMLAllowedIssuers } = await import("@/domains/access/sso.functions");
    const response = (await getWorkspaceSAMLAllowedIssuers.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      issuerOrigins: ["https://accounts.google.com", "https://login.microsoftonline.com"],
    });
  });
});
