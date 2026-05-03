import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasSAMLProviderHealth } from "@/domains/access/sso.functions";
import {
  createSSOSignInResolutionFixture,
  createStoredWorkspaceIdentityFixture,
  createStoredWorkspaceSSOProviderFixture,
} from "../../../fixtures/access/sso";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";
import { createSSOFunctionsAuthApi } from "../../../mocks/access/sso-functions-auth";
import {
  createServerFnStub,
  type ServerFnExecutionResponse,
} from "../../../helpers/server-fn-stub";

const mocks = vi.hoisted(() => ({
  ensureAuthReady: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getSamlAllowedIssuerOrigins: vi.fn(),
  isAllowedSamlIssuer: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  loadOrganizationRequestContext: vi.fn(),
  loadStoredWorkspaceIdentity: vi.fn(),
  listStoredWorkspaceSSOProviders: vi.fn(),
  requireManagedTeamWorkspace: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: createServerFnStub(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

vi.mock("@/domains/access/server/request-headers", () => ({
  getBrowserSessionHeaders: mocks.getBrowserSessionHeaders,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
  getSamlAllowedIssuerOrigins: mocks.getSamlAllowedIssuerOrigins,
  isAllowedSamlIssuer: mocks.isAllowedSamlIssuer,
}));

vi.mock("@/domains/access/organization-server-helpers", () => ({
  loadOrganizationRequestContext: mocks.loadOrganizationRequestContext,
  requireManagedTeamWorkspace: mocks.requireManagedTeamWorkspace,
}));

vi.mock("@/domains/access/server/sso-provider-store", () => ({
  listStoredWorkspaceSSOProviders: mocks.listStoredWorkspaceSSOProviders,
  loadStoredWorkspaceIdentity: mocks.loadStoredWorkspaceIdentity,
}));

describe("sso.functions", () => {
  const browserSessionHeaders = new Headers({
    cookie: "better-auth.session_token=test-token",
  });

  const managedTeamWorkspace = createAtlasWorkspace().activeOrganization;
  if (!managedTeamWorkspace) {
    throw new TypeError("Expected the access session fixture to expose an active workspace.");
  }

  let authApi = createSSOFunctionsAuthApi();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    authApi = createSSOFunctionsAuthApi();

    const session = createAtlasSessionFixture({
      workspace: createAtlasWorkspace({
        activeOrganization: managedTeamWorkspace,
      }),
    });

    mocks.ensureAuthReady.mockResolvedValue({
      api: authApi,
    });
    mocks.getAuthRuntimeConfig.mockReturnValue({
      publicBaseUrl: "https://atlas.test",
      samlAllowedIssuerOrigins: new Set(["https://accounts.google.com"]),
      samlSpPrivateKey: null,
      samlSpPrivateKeyPass: null,
    });
    mocks.isAllowedSamlIssuer.mockReturnValue(true);
    mocks.getSamlAllowedIssuerOrigins.mockReturnValue(["https://accounts.google.com"]);
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.loadOrganizationRequestContext.mockResolvedValue({
      auth: {
        api: authApi,
      },
      headers: browserSessionHeaders,
      session,
    });
    mocks.loadStoredWorkspaceIdentity.mockReturnValue(createStoredWorkspaceIdentityFixture());
    mocks.listStoredWorkspaceSSOProviders.mockReturnValue([]);
    mocks.requireManagedTeamWorkspace.mockReturnValue(managedTeamWorkspace);
  });

  it("registers a Google Workspace OIDC provider and saves it as primary when requested", async () => {
    authApi.registerSSOProvider.mockResolvedValue({
      domainVerificationToken: "token_123",
      providerId: "atlas-team-google-workspace-oidc",
      redirectURI: "https://atlas.test/api/auth/sso/callback",
    });

    const modulePromise = import("@/domains/access/sso.functions");
    const { registerWorkspaceGoogleOIDCProvider } = await modulePromise;

    const responsePromise = registerWorkspaceGoogleOIDCProvider.__executeServer({
      method: "POST",
      data: {
        clientId: "client_123",
        clientSecret: "secret_456",
        domain: "policy.example",
        setAsPrimary: true,
      },
    });
    const response = (await responsePromise) as ServerFnExecutionResponse;

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
      | UpdateOrgCall
      | undefined;
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

    const modulePromise = import("@/domains/access/sso.functions");
    const { registerWorkspaceSAMLProvider } = await modulePromise;

    const responsePromise = registerWorkspaceSAMLProvider.__executeServer({
      method: "POST",
      data: {
        certificate: "-----BEGIN CERTIFICATE-----test",
        domain: "policy.example",
        entryPoint: "https://accounts.google.com/o/saml2/idp?idpid=abc123",
        issuer: "https://accounts.google.com/o/saml2?idpid=abc123",
        setAsPrimary: false,
      },
    });
    const response = (await responsePromise) as ServerFnExecutionResponse;

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
    mocks.isAllowedSamlIssuer.mockReturnValue(false);

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
    expect(mocks.isAllowedSamlIssuer).toHaveBeenCalledWith("https://idp.attacker.example");
  });

  it("sets a workspace primary SSO provider", async () => {
    const modulePromise = import("@/domains/access/sso.functions");
    const { setWorkspacePrimarySSOProvider } = await modulePromise;

    const responsePromise = setWorkspacePrimarySSOProvider.__executeServer({
      method: "POST",
      data: {
        providerId: "google-oidc",
      },
    });
    const response = (await responsePromise) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.updateOrganization).toHaveBeenCalled();
    expect(response.result).toEqual({ ok: true });
  });

  it("verifies a workspace SSO domain", async () => {
    const modulePromise = import("@/domains/access/sso.functions");
    const { verifyWorkspaceSSODomain } = await modulePromise;

    const responsePromise = verifyWorkspaceSSODomain.__executeServer({
      method: "POST",
      data: {
        providerId: "google-oidc",
      },
    });
    const response = (await responsePromise) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(authApi.verifyDomain).toHaveBeenCalledWith({
      body: { providerId: "google-oidc" },
      headers: browserSessionHeaders,
    });
    expect(response.result).toEqual({ ok: true });
  });

  it("requests a fresh domain verification token for one provider", async () => {
    const modulePromise = import("@/domains/access/sso.functions");
    const { requestWorkspaceSSODomainVerification } = await modulePromise;

    const responsePromise = requestWorkspaceSSODomainVerification.__executeServer({
      method: "POST",
      data: {
        providerId: "atlas-team-google-workspace-saml",
      },
    });
    const response = (await responsePromise) as ServerFnExecutionResponse;

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
    mocks.loadStoredWorkspaceIdentity.mockReturnValue(
      createStoredWorkspaceIdentityFixture({
        primaryProviderId: "atlas-team-google-workspace-saml",
      }),
    );

    const modulePromise = import("@/domains/access/sso.functions");
    const { deleteWorkspaceSSOProvider } = await modulePromise;

    const responsePromise = deleteWorkspaceSSOProvider.__executeServer({
      method: "POST",
      data: {
        providerId: "atlas-team-google-workspace-saml",
      },
    });
    const response = (await responsePromise) as ServerFnExecutionResponse;

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

  it("routes invitation sign-in through the workspace primary provider", async () => {
    authApi.getInvitation.mockResolvedValue({
      organizationId: "org_team",
    });
    mocks.listStoredWorkspaceSSOProviders.mockReturnValue([
      createStoredWorkspaceSSOProviderFixture({
        hasOIDC: false,
        hasSAML: true,
        providerId: "atlas-team-google-workspace-saml",
      }),
      createStoredWorkspaceSSOProviderFixture({
        hasOIDC: true,
        hasSAML: false,
        providerId: "atlas-team-google-workspace-oidc",
      }),
    ]);
    mocks.loadStoredWorkspaceIdentity.mockReturnValue(
      createStoredWorkspaceIdentityFixture({
        primaryProviderId: "atlas-team-google-workspace-oidc",
      }),
    );

    const modulePromise = import("@/domains/access/sso.functions");
    const { resolveWorkspaceSSOSignIn } = await modulePromise;

    const responsePromise = resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: {
        email: "owner@atlas.test",
        invitationId: "invite_123",
      },
    });
    const response = (await responsePromise) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(
      createSSOSignInResolutionFixture({
        providerId: "atlas-team-google-workspace-oidc",
        providerType: "oidc",
      }),
    );
  });

  it("routes generic domain sign-in through the workspace primary provider", async () => {
    mocks.listStoredWorkspaceSSOProviders.mockReturnValue([
      createStoredWorkspaceSSOProviderFixture({
        hasOIDC: false,
        hasSAML: true,
        providerId: "atlas-team-google-workspace-saml",
      }),
      createStoredWorkspaceSSOProviderFixture({
        hasOIDC: true,
        hasSAML: false,
        providerId: "atlas-team-google-workspace-oidc",
      }),
    ]);
    mocks.loadStoredWorkspaceIdentity.mockReturnValue(
      createStoredWorkspaceIdentityFixture({
        primaryProviderId: "atlas-team-google-workspace-oidc",
      }),
    );

    const modulePromise = import("@/domains/access/sso.functions");
    const { resolveWorkspaceSSOSignIn } = await modulePromise;

    const responsePromise = resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: {
        email: "owner@atlas.test",
      },
    });
    const response = (await responsePromise) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(
      createSSOSignInResolutionFixture({
        providerId: "atlas-team-google-workspace-oidc",
        providerType: "oidc",
      }),
    );
  });

  it("falls back to magic link when more than one workspace matches the same verified domain", async () => {
    mocks.listStoredWorkspaceSSOProviders.mockReturnValue([
      createStoredWorkspaceSSOProviderFixture({
        organizationId: "org_team",
        providerId: "atlas-team-google-workspace-saml",
      }),
      createStoredWorkspaceSSOProviderFixture({
        organizationId: "org_other",
        providerId: "other-team-google-workspace-saml",
      }),
    ]);
    mocks.loadStoredWorkspaceIdentity.mockImplementation((organizationId: string) => {
      if (organizationId === "org_team") {
        return createStoredWorkspaceIdentityFixture({
          id: "org_team",
          name: "Atlas Team",
          primaryProviderId: "atlas-team-google-workspace-saml",
          slug: "atlas-team",
        });
      }

      if (organizationId === "org_other") {
        return createStoredWorkspaceIdentityFixture({
          id: "org_other",
          name: "Research Desk",
          primaryProviderId: "other-team-google-workspace-saml",
          slug: "research-desk",
        });
      }

      return null;
    });

    const modulePromise = import("@/domains/access/sso.functions");
    const { resolveWorkspaceSSOSignIn } = await modulePromise;

    const responsePromise = resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: {
        email: "owner@atlas.test",
      },
    });
    const response = (await responsePromise) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toBeNull();
  });

  it("returns null for generic domain sign-in when the domain has no providers", async () => {
    const { resolveWorkspaceSSOSignIn } = await import("@/domains/access/sso.functions");
    const response = (await resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: { email: "nobody@unknown-domain.com" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toBeNull();
  });

  it("returns null for invitation sign-in when the organization is missing", async () => {
    authApi.getInvitation.mockResolvedValue({ organizationId: "missing_org" });
    mocks.loadStoredWorkspaceIdentity.mockReturnValue(null);

    const { resolveWorkspaceSSOSignIn } = await import("@/domains/access/sso.functions");
    const response = (await resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: { email: "user@atlas.test", invitationId: "inv_123" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toBeNull();
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

  it("skips primary marker clearing when deleting a non-primary provider", async () => {
    mocks.loadStoredWorkspaceIdentity.mockReturnValue({
      primaryProviderId: "other_provider",
    });

    const { deleteWorkspaceSSOProvider } = await import("@/domains/access/sso.functions");
    await deleteWorkspaceSSOProvider.__executeServer({
      method: "POST",
      data: { providerId: "saml_123" },
    });

    expect(authApi.updateOrganization).not.toHaveBeenCalled();
  });

  it("returns the operator-managed SAML issuer allowlist", async () => {
    mocks.getSamlAllowedIssuerOrigins.mockReturnValue([
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

  it("registers a SAML provider with SP signing material when configured", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
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

  it("returns null for invitation sign-in when no invitation is found", async () => {
    authApi.getInvitation.mockResolvedValue(null);

    const { resolveWorkspaceSSOSignIn } = await import("@/domains/access/sso.functions");
    const response = (await resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: { email: "user@atlas.test", invitationId: "missing" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toBeNull();
  });

  it("falls back to generic resolution when invitation provider does not match email domain", async () => {
    authApi.getInvitation.mockResolvedValue({ organizationId: "org_team" });
    mocks.loadStoredWorkspaceIdentity.mockReturnValue(
      createStoredWorkspaceIdentityFixture({
        primaryProviderId: "atlas-team-google-workspace-saml",
      }),
    );
    mocks.listStoredWorkspaceSSOProviders.mockReturnValue([
      createStoredWorkspaceSSOProviderFixture({
        domain: "different.example",
        domainVerified: true,
        organizationId: "org_team",
        providerId: "atlas-team-google-workspace-saml",
      }),
    ]);

    const { resolveWorkspaceSSOSignIn } = await import("@/domains/access/sso.functions");
    const response = (await resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: { email: "owner@atlas.test", invitationId: "inv_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toBeNull();
  });

  it("falls back to generic resolution when invitation has no matching identity", async () => {
    authApi.getInvitation.mockResolvedValue({ organizationId: "org_team" });
    mocks.loadStoredWorkspaceIdentity.mockReturnValue(null);
    mocks.listStoredWorkspaceSSOProviders.mockReturnValue([
      createStoredWorkspaceSSOProviderFixture({
        hasOIDC: true,
        hasSAML: false,
        organizationId: "org_team",
        providerId: "atlas-team-google-workspace-oidc",
      }),
    ]);

    const { resolveWorkspaceSSOSignIn } = await import("@/domains/access/sso.functions");
    const response = (await resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: { email: "owner@atlas.test", invitationId: "inv_123" },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toBeNull();
  });
});
