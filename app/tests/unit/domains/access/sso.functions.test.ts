import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSSOSignInResolutionFixture,
  createStoredWorkspaceIdentityFixture,
  createStoredWorkspaceSSOProviderFixture,
} from "../../../fixtures/access/sso";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";
import { createSSOFunctionsAuthApi } from "../../../mocks/access/sso-functions-auth";
import { createServerFnStub, type ServerFnExecutionResponse } from "../../../utils/server-fn-stub";

const mocks = vi.hoisted(() => ({
  ensureAuthReady: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
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
}));

vi.mock("@/domains/access/organization-server-helpers", () => ({
  loadOrganizationRequestContext: mocks.loadOrganizationRequestContext,
  requireManagedTeamWorkspace: mocks.requireManagedTeamWorkspace,
}));

vi.mock("@/domains/access/server/sso-provider-store", () => ({
  listStoredWorkspaceSSOProviders: mocks.listStoredWorkspaceSSOProviders,
  loadStoredWorkspaceIdentity: mocks.loadStoredWorkspaceIdentity,
}));

/**
 * Builds the managed team-workspace membership used by SSO server-function
 * tests.
 */
function createManagedTeamWorkspace() {
  return createAtlasWorkspace().activeOrganization;
}

describe("sso.functions", () => {
  const browserSessionHeaders = new Headers({
    cookie: "better-auth.session_token=test-token",
  });

  const managedTeamWorkspace = createManagedTeamWorkspace();
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
    });
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
    expect(authApi.updateOrganization).toHaveBeenCalledWith({
      body: {
        data: {
          metadata: {
            ssoPrimaryProviderId: "atlas-team-google-workspace-oidc",
            stripeCustomerId: null,
            workspaceType: "team",
          },
        },
        organizationId: "org_team",
      },
      headers: browserSessionHeaders,
    });
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
});
