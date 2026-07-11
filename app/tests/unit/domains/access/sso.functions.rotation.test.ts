import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSsoFunctionsAuthApi,
  getSsoFunctionsBrowserSessionHeaders,
  getSsoFunctionsMocks,
  resetSsoFunctionsTestBed,
} from "../../../helpers/access/sso-functions-test-bed";
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

describe("sso.functions certificate rotation", () => {
  const browserSessionHeaders = getSsoFunctionsBrowserSessionHeaders();
  let authApi = getSsoFunctionsAuthApi();

  beforeEach(() => {
    resetSsoFunctionsTestBed();
    authApi = getSsoFunctionsAuthApi();
  });

  it("rotates the SAML signing certificate for the active workspace provider", async () => {
    authApi.getSSOProvider.mockResolvedValue({ organizationId: "org_team" });

    const { rotateWorkspaceSAMLCertificate } = await import("@/domains/access/sso.functions");
    const response = (await rotateWorkspaceSAMLCertificate.__executeServer({
      method: "POST",
      data: {
        certificate: "-----BEGIN CERTIFICATE-----rotated",
        providerId: "saml_123",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ ok: true });
    expect(authApi.updateSSOProvider).toHaveBeenCalledWith({
      body: {
        providerId: "saml_123",
        samlConfig: { cert: "-----BEGIN CERTIFICATE-----rotated" },
      },
      headers: browserSessionHeaders,
    });
  });

  it("rejects rotating a SAML certificate for a provider in another workspace", async () => {
    authApi.getSSOProvider.mockResolvedValue({ organizationId: "other_org" });

    const { rotateWorkspaceSAMLCertificate } = await import("@/domains/access/sso.functions");
    const response = (await rotateWorkspaceSAMLCertificate.__executeServer({
      method: "POST",
      data: {
        certificate: "-----BEGIN CERTIFICATE-----rotated",
        providerId: "saml_123",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain("not registered to the active workspace");
    expect(authApi.updateSSOProvider).not.toHaveBeenCalled();
  });
});
