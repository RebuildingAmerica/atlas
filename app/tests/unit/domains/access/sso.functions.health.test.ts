import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasSAMLProviderHealth } from "@/domains/access/sso.functions";
import {
  getSsoFunctionsAuthApi,
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

describe("sso.functions health checks", () => {
  let authApi = getSsoFunctionsAuthApi();

  beforeEach(() => {
    resetSsoFunctionsTestBed();
    authApi = getSsoFunctionsAuthApi();
  });

  it("reports SAML provider health when the IdP entry point and certificate are valid", async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString();
    authApi.getSSOProvider.mockResolvedValue({
      organizationId: "org_team",
      samlConfig: {
        certificate: {
          fingerprintSha256: "AB:CD",
          notAfter: futureDate,
        },
        entryPoint: "https://accounts.google.com/o/saml2/idp?idpid=abc",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const { checkWorkspaceSAMLProviderHealth } = await import("@/domains/access/sso.functions");
    const response = (await checkWorkspaceSAMLProviderHealth.__executeServer({
      method: "POST",
      data: { providerId: "saml_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      certificateValid: true,
      certificateExpired: false,
      entryPointReachable: true,
      entryPointStatus: 200,
      reason: null,
    });
    vi.unstubAllGlobals();
  });

  it("flags SAML provider health when the certificate has expired", async () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    authApi.getSSOProvider.mockResolvedValue({
      organizationId: "org_team",
      samlConfig: {
        certificate: {
          fingerprintSha256: "AB:CD",
          notAfter: pastDate,
        },
        entryPoint: "https://accounts.google.com/o/saml2/idp",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const { checkWorkspaceSAMLProviderHealth } = await import("@/domains/access/sso.functions");
    const response = (await checkWorkspaceSAMLProviderHealth.__executeServer({
      method: "POST",
      data: { providerId: "saml_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const samlHealth = response.result as AtlasSAMLProviderHealth;
    expect(samlHealth.certificateExpired).toBe(true);
    expect(samlHealth.reason).toContain("expired");
    vi.unstubAllGlobals();
  });

  it("flags SAML provider health when the certificate could not be parsed", async () => {
    authApi.getSSOProvider.mockResolvedValue({
      organizationId: "org_team",
      samlConfig: {
        certificate: { rawValue: "garbage" },
        entryPoint: "https://accounts.google.com/o/saml2/idp",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const { checkWorkspaceSAMLProviderHealth } = await import("@/domains/access/sso.functions");
    const response = (await checkWorkspaceSAMLProviderHealth.__executeServer({
      method: "POST",
      data: { providerId: "saml_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const samlHealth = response.result as AtlasSAMLProviderHealth;
    expect(samlHealth.certificateValid).toBe(false);
    expect(samlHealth.reason).toContain("could not parse");
    vi.unstubAllGlobals();
  });

  it("refuses to probe a non-public SAML IdP entry point", async () => {
    authApi.getSSOProvider.mockResolvedValue({
      organizationId: "org_team",
      samlConfig: {
        certificate: {
          fingerprintSha256: "AB:CD",
          notAfter: new Date(Date.now() + 86400000).toISOString(),
        },
        entryPoint: "http://127.0.0.1/idp",
      },
    });

    const { checkWorkspaceSAMLProviderHealth } = await import("@/domains/access/sso.functions");
    const response = (await checkWorkspaceSAMLProviderHealth.__executeServer({
      method: "POST",
      data: { providerId: "saml_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const samlHealth = response.result as AtlasSAMLProviderHealth;
    expect(samlHealth.entryPointReachable).toBe(false);
    expect(samlHealth.reason).toContain("non-public");
  });

  it("refuses to probe an HTTPS SAML IdP entry point on a deny-listed host", async () => {
    authApi.getSSOProvider.mockResolvedValue({
      organizationId: "org_team",
      samlConfig: {
        certificate: {
          fingerprintSha256: "AB:CD",
          notAfter: new Date(Date.now() + 86400000).toISOString(),
        },
        entryPoint: "https://10.0.0.5/idp",
      },
    });

    const { checkWorkspaceSAMLProviderHealth } = await import("@/domains/access/sso.functions");
    const response = (await checkWorkspaceSAMLProviderHealth.__executeServer({
      method: "POST",
      data: { providerId: "saml_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const samlHealth = response.result as AtlasSAMLProviderHealth;
    expect(samlHealth.entryPointReachable).toBe(false);
    expect(samlHealth.reason).toContain("non-public");
  });

  it("refuses to probe a malformed SAML IdP entry point", async () => {
    authApi.getSSOProvider.mockResolvedValue({
      organizationId: "org_team",
      samlConfig: {
        certificate: {
          fingerprintSha256: "AB:CD",
          notAfter: new Date(Date.now() + 86400000).toISOString(),
        },
        entryPoint: "not-a-url",
      },
    });

    const { checkWorkspaceSAMLProviderHealth } = await import("@/domains/access/sso.functions");
    const response = (await checkWorkspaceSAMLProviderHealth.__executeServer({
      method: "POST",
      data: { providerId: "saml_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const samlHealth = response.result as AtlasSAMLProviderHealth;
    expect(samlHealth.entryPointReachable).toBe(false);
    expect(samlHealth.reason).toContain("non-public");
  });

  it("reports SAML provider health when the IdP entry point fetch fails", async () => {
    authApi.getSSOProvider.mockResolvedValue({
      organizationId: "org_team",
      samlConfig: {
        certificate: {
          fingerprintSha256: "AB:CD",
          notAfter: new Date(Date.now() + 86400000).toISOString(),
        },
        entryPoint: "https://accounts.google.com/o/saml2/idp",
      },
    });
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const { checkWorkspaceSAMLProviderHealth } = await import("@/domains/access/sso.functions");
    const response = (await checkWorkspaceSAMLProviderHealth.__executeServer({
      method: "POST",
      data: { providerId: "saml_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      entryPointReachable: false,
      reason: "ECONNREFUSED",
    });
    vi.unstubAllGlobals();
  });

  it("returns a generic IdP-unreachable reason when fetch throws a non-Error value", async () => {
    authApi.getSSOProvider.mockResolvedValue({
      organizationId: "org_team",
      samlConfig: {
        certificate: {
          fingerprintSha256: "AB:CD",
          notAfter: new Date(Date.now() + 86400000).toISOString(),
        },
        entryPoint: "https://accounts.google.com/o/saml2/idp",
      },
    });
    const fetchMock = vi.fn().mockRejectedValue("network blip");
    vi.stubGlobal("fetch", fetchMock);

    const { checkWorkspaceSAMLProviderHealth } = await import("@/domains/access/sso.functions");
    const response = (await checkWorkspaceSAMLProviderHealth.__executeServer({
      method: "POST",
      data: { providerId: "saml_123" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toMatchObject({
      reason: "Atlas could not reach the IdP.",
    });
    vi.unstubAllGlobals();
  });

  it("rejects SAML health checks for a provider in another workspace", async () => {
    authApi.getSSOProvider.mockResolvedValue({ organizationId: "other_org" });

    const { checkWorkspaceSAMLProviderHealth } = await import("@/domains/access/sso.functions");
    const response = (await checkWorkspaceSAMLProviderHealth.__executeServer({
      method: "POST",
      data: { providerId: "saml_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      reason: "Provider is not registered to this workspace.",
    });
  });

  it("rejects SAML health checks for a non-SAML provider", async () => {
    authApi.getSSOProvider.mockResolvedValue({
      organizationId: "org_team",
    });

    const { checkWorkspaceSAMLProviderHealth } = await import("@/domains/access/sso.functions");
    const response = (await checkWorkspaceSAMLProviderHealth.__executeServer({
      method: "POST",
      data: { providerId: "oidc_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    const samlHealth = response.result as AtlasSAMLProviderHealth;
    expect(samlHealth.reason).toContain("SAML-only");
  });
});
