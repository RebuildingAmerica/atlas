import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

/**
 * Builds one SQLite statement stub for provider-store tests.
 *
 * @param params - The statement results to expose.
 * @param params.allResult - The rows returned by `all()`.
 * @param params.getResult - The row returned by `get()`.
 */
function createStatement(params: { allResult?: unknown[]; getResult?: unknown }) {
  return {
    all: vi.fn().mockReturnValue(params.allResult ?? []),
    get: vi.fn().mockReturnValue(params.getResult),
  };
}

describe("sso-provider-store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mocks.getAuthRuntimeConfig.mockReturnValue({
      publicBaseUrl: "https://atlas.test",
    });
  });

  it("loads stored workspace identity with normalized primary-provider metadata", async () => {
    const identityStatement = createStatement({
      getResult: {
        id: "org_team",
        metadata: JSON.stringify({
          ssoPrimaryProviderId: "atlas-team-google-workspace-saml",
          workspaceType: "team",
        }),
        name: "Atlas Team",
        slug: "atlas-team",
      },
    });
    const prepare = vi.fn().mockReturnValue(identityStatement);

    mocks.getAuthDatabase.mockReturnValue({
      prepare,
    });

    const modulePromise = import("@/domains/access/server/sso-provider-store");
    const { loadStoredWorkspaceIdentity } = await modulePromise;

    const workspaceIdentity = loadStoredWorkspaceIdentity("org_team");

    expect(prepare).toHaveBeenCalledWith(
      "select id, metadata, name, slug from organization where id = ? limit 1",
    );
    expect(identityStatement.get).toHaveBeenCalledWith("org_team");
    expect(workspaceIdentity).toEqual({
      id: "org_team",
      name: "Atlas Team",
      primaryProviderId: "atlas-team-google-workspace-saml",
      slug: "atlas-team",
    });
  });

  it("lists stored providers and normalizes OIDC and SAML flags", async () => {
    const providerStatement = createStatement({
      allResult: [
        {
          domain: "atlas.test",
          domainVerified: 1,
          issuer: "https://accounts.google.com",
          oidcConfig: JSON.stringify({
            authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
            clientIdLastFour: "1234",
            discoveryEndpoint: "https://accounts.google.com/.well-known/openid-configuration",
            pkce: true,
            scopes: ["openid", "email", "profile"],
          }),
          organizationId: "org_team",
          providerId: "atlas-team-google-workspace-oidc",
          samlConfig: null,
        },
        {
          domain: "atlas.test",
          domainVerified: 1,
          issuer: "https://accounts.google.com/o/saml2?idpid=abc123",
          oidcConfig: null,
          organizationId: "org_team",
          providerId: "atlas-team-google-workspace-saml",
          samlConfig: JSON.stringify({
            callbackUrl:
              "https://atlas.test/api/auth/sso/saml2/sp/acs/atlas-team-google-workspace-saml",
            certificate: {
              fingerprintSha256: "AA:BB:CC",
              notAfter: "2027-04-12T00:00:00.000Z",
              notBefore: "2026-04-12T00:00:00.000Z",
              publicKeyAlgorithm: "rsaEncryption",
            },
            entryPoint: "https://accounts.google.com/o/saml2/idp?idpid=abc123",
          }),
        },
      ],
    });
    const prepare = vi.fn().mockReturnValue(providerStatement);

    mocks.getAuthDatabase.mockReturnValue({
      prepare,
    });

    const modulePromise = import("@/domains/access/server/sso-provider-store");
    const { listStoredWorkspaceSSOProviders } = await modulePromise;

    const providers = listStoredWorkspaceSSOProviders();

    expect(prepare).toHaveBeenCalledWith(
      "select providerId, issuer, domain, organizationId, domainVerified, oidcConfig, samlConfig from ssoProvider",
    );
    expect(providers).toEqual([
      {
        domain: "atlas.test",
        domainVerified: true,
        hasOIDC: true,
        hasSAML: false,
        issuer: "https://accounts.google.com",
        organizationId: "org_team",
        providerId: "atlas-team-google-workspace-oidc",
        spMetadataUrl:
          "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-oidc&format=xml",
      },
      {
        domain: "atlas.test",
        domainVerified: true,
        hasOIDC: false,
        hasSAML: true,
        issuer: "https://accounts.google.com/o/saml2?idpid=abc123",
        organizationId: "org_team",
        providerId: "atlas-team-google-workspace-saml",
        spMetadataUrl:
          "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
      },
    ]);
  });
});
