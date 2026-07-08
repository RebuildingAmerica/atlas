import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSsoFunctionsAuthApi,
  getSsoFunctionsMocks,
  resetSsoFunctionsTestBed,
} from "../../../helpers/access/sso-functions-test-bed";
import {
  createSSOSignInResolutionFixture,
  createStoredWorkspaceIdentityFixture,
  createStoredWorkspaceSSOProviderFixture,
} from "../../../fixtures/access/sso";
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

describe("sso.functions sign-in resolution", () => {
  const ssoFunctionsMocks = getSsoFunctionsMocks();
  let authApi = getSsoFunctionsAuthApi();

  beforeEach(() => {
    resetSsoFunctionsTestBed();
    authApi = getSsoFunctionsAuthApi();
  });

  it("routes invitation sign-in through the workspace primary provider", async () => {
    authApi.getInvitation.mockResolvedValue({
      organizationId: "org_team",
    });
    ssoFunctionsMocks.listStoredWorkspaceSSOProviders.mockReturnValue([
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
    ssoFunctionsMocks.loadStoredWorkspaceIdentity.mockReturnValue(
      createStoredWorkspaceIdentityFixture({
        primaryProviderId: "atlas-team-google-workspace-oidc",
      }),
    );

    const { resolveWorkspaceSSOSignIn } = await import("@/domains/access/sso.functions");
    const response = (await resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: {
        email: "owner@atlas.test",
        invitationId: "invite_123",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(
      createSSOSignInResolutionFixture({
        providerId: "atlas-team-google-workspace-oidc",
        providerType: "oidc",
      }),
    );
  });

  it("routes generic domain sign-in through the workspace primary provider", async () => {
    ssoFunctionsMocks.listStoredWorkspaceSSOProviders.mockReturnValue([
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
    ssoFunctionsMocks.loadStoredWorkspaceIdentity.mockReturnValue(
      createStoredWorkspaceIdentityFixture({
        primaryProviderId: "atlas-team-google-workspace-oidc",
      }),
    );

    const { resolveWorkspaceSSOSignIn } = await import("@/domains/access/sso.functions");
    const response = (await resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: {
        email: "owner@atlas.test",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(
      createSSOSignInResolutionFixture({
        providerId: "atlas-team-google-workspace-oidc",
        providerType: "oidc",
      }),
    );
  });

  it("falls back to magic link when more than one workspace matches the same verified domain", async () => {
    ssoFunctionsMocks.listStoredWorkspaceSSOProviders.mockReturnValue([
      createStoredWorkspaceSSOProviderFixture({
        organizationId: "org_team",
        providerId: "atlas-team-google-workspace-saml",
      }),
      createStoredWorkspaceSSOProviderFixture({
        organizationId: "org_other",
        providerId: "other-team-google-workspace-saml",
      }),
    ]);
    ssoFunctionsMocks.loadStoredWorkspaceIdentity.mockImplementation((organizationId: string) => {
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

    const { resolveWorkspaceSSOSignIn } = await import("@/domains/access/sso.functions");
    const response = (await resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: {
        email: "owner@atlas.test",
      },
    })) as ServerFnExecutionResponse;

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
    ssoFunctionsMocks.loadStoredWorkspaceIdentity.mockReturnValue(null);

    const { resolveWorkspaceSSOSignIn } = await import("@/domains/access/sso.functions");
    const response = (await resolveWorkspaceSSOSignIn.__executeServer({
      method: "POST",
      data: { email: "user@atlas.test", invitationId: "inv_123" },
    })) as ServerFnExecutionResponse;

    expect(response.result).toBeNull();
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
    ssoFunctionsMocks.loadStoredWorkspaceIdentity.mockReturnValue(
      createStoredWorkspaceIdentityFixture({
        primaryProviderId: "atlas-team-google-workspace-saml",
      }),
    );
    ssoFunctionsMocks.listStoredWorkspaceSSOProviders.mockReturnValue([
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
    ssoFunctionsMocks.loadStoredWorkspaceIdentity.mockReturnValue(null);
    ssoFunctionsMocks.listStoredWorkspaceSSOProviders.mockReturnValue([
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
