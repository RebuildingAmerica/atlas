import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSsoFunctionsAuthApi,
  getSsoFunctionsBrowserSessionHeaders,
  getSsoFunctionsMocks,
  resetSsoFunctionsTestBed,
} from "../../../helpers/access/sso-functions-test-bed";
import {
  createServerFnStub,
  type ServerFnExecutionResponse,
} from "../../../helpers/server-fn-stub";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: createServerFnStub(),
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

describe("sso.functions registration", () => {
  const browserSessionHeaders = getSsoFunctionsBrowserSessionHeaders();
  let authApi = getSsoFunctionsAuthApi();

  beforeEach(() => {
    resetSsoFunctionsTestBed();
    authApi = getSsoFunctionsAuthApi();
  });

  it("registers a Google Workspace OIDC provider and saves it as primary when requested", async () => {
    authApi.registerSSOProvider.mockResolvedValue({
      domainVerificationToken: "token_123",
      providerId: "atlas-team-google-workspace-oidc",
      redirectURI: "https://atlas.test/api/auth/sso/callback",
    });

    const { registerWorkspaceGoogleOIDCProvider } = await import("@/domains/access/sso.functions");
    const response = (await registerWorkspaceGoogleOIDCProvider.__executeServer({
      method: "POST",
      data: {
        clientId: "client_123",
        clientSecret: "secret_456",
        domain: "policy.example",
        setAsPrimary: true,
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.registerSSOProvider).toHaveBeenCalledWith({
      body: {
        domain: "policy.example",
        issuer: "https://accounts.google.com",
        oidcConfig: {
          clientId: "client_123",
          clientSecret: "secret_456",
          scopes: ["openid", "email", "profile"],
        },
        organizationId: "org_team",
        providerId: "atlas-team-google-workspace-oidc",
      },
      headers: browserSessionHeaders,
    });

    interface UpdateOrgCall {
      body: {
        data: {
          metadata: {
            ssoPrimaryProviderId: string;
            ssoPrimaryHistory?: { providerId: string }[];
            stripeCustomerId: string | null;
            workspaceType: string;
          };
        };
        organizationId: string;
      };
      headers: Headers;
    }

    const updateCallArgs = authApi.updateOrganization.mock.calls[0]?.[0] as
      UpdateOrgCall | undefined;
    expect(updateCallArgs?.body.organizationId).toBe("org_team");
    expect(updateCallArgs?.body.data.metadata.ssoPrimaryProviderId).toBe(
      "atlas-team-google-workspace-oidc",
    );
    expect(updateCallArgs?.body.data.metadata.workspaceType).toBe("team");
    expect(updateCallArgs?.body.data.metadata.ssoPrimaryHistory?.[0]?.providerId).toBe(
      "atlas-team-google-workspace-oidc",
    );
    expect(response.result).toEqual({
      domainVerificationToken: "token_123",
      providerId: "atlas-team-google-workspace-oidc",
      redirectUrl: "https://atlas.test/api/auth/sso/callback",
      samlAcsUrl: "https://atlas.test/api/auth/sso/saml2/sp/acs/atlas-team-google-workspace-saml",
      samlEntityId:
        "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
      samlMetadataUrl:
        "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
    });
  });

  it("registers a SAML provider with Atlas service-provider values", async () => {
    authApi.registerSSOProvider.mockResolvedValue({
      domainVerificationToken: "token_789",
      providerId: "atlas-team-google-workspace-saml",
      redirectURI: "https://atlas.test/api/auth/sso/callback",
    });

    const { registerWorkspaceSAMLProvider } = await import("@/domains/access/sso.functions");
    const response = (await registerWorkspaceSAMLProvider.__executeServer({
      method: "POST",
      data: {
        certificate: "-----BEGIN CERTIFICATE-----test",
        domain: "policy.example",
        entryPoint: "https://accounts.google.com/o/saml2/idp?idpid=abc123",
        issuer: "https://accounts.google.com/o/saml2?idpid=abc123",
        setAsPrimary: false,
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.registerSSOProvider).toHaveBeenCalledWith({
      body: {
        domain: "policy.example",
        issuer: "https://accounts.google.com/o/saml2?idpid=abc123",
        organizationId: "org_team",
        providerId: "atlas-team-google-workspace-saml",
        samlConfig: {
          audience:
            "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
          authnRequestsSigned: false,
          callbackUrl:
            "https://atlas.test/api/auth/sso/saml2/sp/acs/atlas-team-google-workspace-saml",
          cert: "-----BEGIN CERTIFICATE-----test",
          entryPoint: "https://accounts.google.com/o/saml2/idp?idpid=abc123",
          identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
          spMetadata: {
            entityID:
              "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
          },
          wantAssertionsSigned: true,
        },
      },
      headers: browserSessionHeaders,
    });
    expect(authApi.updateOrganization).not.toHaveBeenCalled();
    expect(response.result).toEqual({
      domainVerificationToken: "token_789",
      providerId: "atlas-team-google-workspace-saml",
      redirectUrl: "https://atlas.test/api/auth/sso/callback",
      samlAcsUrl: "https://atlas.test/api/auth/sso/saml2/sp/acs/atlas-team-google-workspace-saml",
      samlEntityId:
        "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
      samlMetadataUrl:
        "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
    });
  });

  it("rejects SAML registration when the issuer is not on the operator allowlist", async () => {
    getSsoFunctionsMocks().isAllowedSamlIssuer.mockReturnValue(false);

    const { registerWorkspaceSAMLProvider } = await import("@/domains/access/sso.functions");
    const response = (await registerWorkspaceSAMLProvider.__executeServer({
      method: "POST",
      data: {
        certificate: "-----BEGIN CERTIFICATE-----test",
        domain: "policy.example",
        entryPoint: "https://idp.attacker.example/sso",
        issuer: "https://idp.attacker.example",
        setAsPrimary: false,
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeDefined();
    expect(authApi.registerSSOProvider).not.toHaveBeenCalled();
    expect(getSsoFunctionsMocks().isAllowedSamlIssuer).toHaveBeenCalledWith(
      "https://idp.attacker.example",
    );
  });

  it("skips primary provider update when setAsPrimary is false", async () => {
    authApi.registerSSOProvider.mockResolvedValue({
      domainVerificationToken: "token_123",
      providerId: "oidc_123",
      redirectURI: "https://atlas.test/callback",
    });

    const { registerWorkspaceGoogleOIDCProvider } = await import("@/domains/access/sso.functions");
    await registerWorkspaceGoogleOIDCProvider.__executeServer({
      method: "POST",
      data: {
        clientId: "c",
        clientSecret: "s",
        domain: "d.com",
        setAsPrimary: false,
      },
    });

    expect(authApi.updateOrganization).not.toHaveBeenCalled();
  });

  it("updates primary provider during SAML registration when requested", async () => {
    authApi.registerSSOProvider.mockResolvedValue({
      domainVerificationToken: "token_123",
      providerId: "saml_123",
      redirectURI: "https://atlas.test/callback",
    });

    const { registerWorkspaceSAMLProvider } = await import("@/domains/access/sso.functions");
    await registerWorkspaceSAMLProvider.__executeServer({
      method: "POST",
      data: {
        certificate: "c",
        domain: "d.com",
        entryPoint: "https://idp.com",
        issuer: "i",
        setAsPrimary: true,
      },
    });

    expect(authApi.updateOrganization).toHaveBeenCalled();
  });

  it("registers a SAML provider with SP signing material when configured", async () => {
    getSsoFunctionsMocks().getAuthRuntimeConfig.mockReturnValue({
      publicBaseUrl: "https://atlas.test",
      samlAllowedIssuerOrigins: new Set(["https://accounts.google.com"]),
      samlSpPrivateKey: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----",
      samlSpPrivateKeyPass: "passphrase",
    });
    authApi.registerSSOProvider.mockResolvedValue({
      domainVerificationToken: "token_signed",
      providerId: "atlas-team-google-workspace-saml",
      redirectURI: "https://atlas.test/api/auth/sso/callback",
    });

    const { registerWorkspaceSAMLProvider } = await import("@/domains/access/sso.functions");
    const response = (await registerWorkspaceSAMLProvider.__executeServer({
      method: "POST",
      data: {
        certificate: "-----BEGIN CERTIFICATE-----test",
        domain: "policy.example",
        entryPoint: "https://accounts.google.com/o/saml2/idp?idpid=abc123",
        issuer: "https://accounts.google.com/o/saml2?idpid=abc123",
        setAsPrimary: false,
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();

    interface RegisterCall {
      body: {
        samlConfig: {
          authnRequestsSigned: boolean;
          spMetadata: { entityID: string; privateKey?: string; privateKeyPass?: string };
          privateKey?: string;
        };
      };
    }

    const call = authApi.registerSSOProvider.mock.calls[0]?.[0] as RegisterCall | undefined;
    expect(call?.body.samlConfig.authnRequestsSigned).toBe(true);
    expect(call?.body.samlConfig.spMetadata.privateKey).toBe(
      "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----",
    );
    expect(call?.body.samlConfig.spMetadata.privateKeyPass).toBe("passphrase");
    expect(call?.body.samlConfig.privateKey).toBe(
      "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----",
    );
  });
});
