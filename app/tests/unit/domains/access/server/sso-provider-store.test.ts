import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listStoredWorkspaceSSOProviders,
  loadStoredWorkspaceIdentity,
} from "@/domains/access/server/sso-provider-store";
import type { MockPool, MockSqliteDatabase } from "@/../tests/helpers/access/sso-provider-mocks";

const mocks = vi.hoisted(() => {
  const pool: MockPool = { query: vi.fn() };
  return {
    pool,
    getAuthPgPool: vi.fn<() => MockPool | null>(() => pool),
    getAuthDatabase: vi.fn<() => MockSqliteDatabase | null>(),
    getAuthRuntimeConfig: vi.fn(),
  };
});

vi.mock("@/domains/access/server/auth", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

describe("sso-provider-store", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.pool.query.mockReset();
    mocks.getAuthDatabase.mockReset();
    mocks.getAuthPgPool.mockReset();
    mocks.getAuthPgPool.mockReturnValue(mocks.pool);
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.getAuthRuntimeConfig.mockReturnValue({
      publicBaseUrl: "https://atlas.test",
    });
  });

  it("loads a workspace identity from the database", async () => {
    mocks.pool.query.mockResolvedValue({
      rows: [
        {
          id: "org_123",
          name: "Atlas",
          slug: "atlas",
          metadata: JSON.stringify({ workspaceType: "team", ssoPrimaryProviderId: "google" }),
        },
      ],
    });

    const identity = await loadStoredWorkspaceIdentity("org_123");

    expect(identity).toEqual({
      id: "org_123",
      name: "Atlas",
      primaryProviderId: "google",
      slug: "atlas",
    });
    expect(mocks.pool.query).toHaveBeenCalledWith(expect.stringContaining("from organization"), [
      "org_123",
    ]);
  });

  it("returns null when a workspace is not found", async () => {
    mocks.pool.query.mockResolvedValue({ rows: [] });

    const identity = await loadStoredWorkspaceIdentity("missing");
    expect(identity).toBeNull();
  });

  it("lists all stored SSO providers", async () => {
    mocks.pool.query.mockResolvedValue({
      rows: [
        {
          providerId: "google",
          issuer: "https://accounts.google.com",
          domain: "atlas.test",
          organizationId: "org_123",
          domainVerified: true,
          oidcConfig: JSON.stringify({
            clientIdLastFour: "1234",
            discoveryEndpoint: "https://accounts.google.com/.well-known/openid-configuration",
            pkce: true,
          }),
          samlConfig: null,
        },
      ],
    });

    const providers = await listStoredWorkspaceSSOProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]).toEqual(
      expect.objectContaining({
        providerId: "google",
        domain: "atlas.test",
        domainVerified: true,
        hasOIDC: true,
        hasSAML: false,
      }),
    );
  });

  it("recognizes SAML providers and tolerates malformed JSON for the OIDC slot", async () => {
    mocks.pool.query.mockResolvedValue({
      rows: [
        {
          providerId: "okta-saml",
          issuer: "https://okta.example.com/saml",
          domain: "saml.atlas.test",
          organizationId: "org_saml",
          domainVerified: false,
          oidcConfig: "{not json",
          samlConfig: JSON.stringify({
            callbackUrl: "https://atlas.test/sso/callback/okta-saml",
            certificate: { error: "no certificate metadata" },
            entryPoint: "https://okta.example.com/saml/sso",
          }),
        },
      ],
    });

    const providers = await listStoredWorkspaceSSOProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]).toEqual(
      expect.objectContaining({
        providerId: "okta-saml",
        domain: "saml.atlas.test",
        domainVerified: false,
        hasOIDC: false,
        hasSAML: true,
      }),
    );
  });

  it("loads workspace identity from SQLite when no Postgres pool is configured", async () => {
    mocks.getAuthPgPool.mockReturnValue(null);
    const get = vi.fn().mockReturnValue({
      id: "org_456",
      name: "Local Atlas",
      slug: "local-atlas",
      metadata: null,
    });
    mocks.getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get }),
    });

    const identity = await loadStoredWorkspaceIdentity("org_456");

    expect(identity).toEqual({
      id: "org_456",
      name: "Local Atlas",
      primaryProviderId: null,
      slug: "local-atlas",
    });
  });

  it("throws when neither a Postgres pool nor a SQLite database is configured for identity lookup", async () => {
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.getAuthDatabase.mockReturnValue(null);

    await expect(loadStoredWorkspaceIdentity("org_404")).rejects.toThrow(
      /No database configured for SSO provider lookup/,
    );
  });

  it("lists SSO providers from SQLite when no Postgres pool is configured", async () => {
    mocks.getAuthPgPool.mockReturnValue(null);
    const all = vi.fn().mockReturnValue([
      {
        providerId: "sqlite-google",
        issuer: "https://accounts.google.com",
        domain: "sqlite.atlas.test",
        organizationId: "org_sqlite",
        domainVerified: 1,
        oidcConfig: JSON.stringify({
          clientIdLastFour: "9999",
          discoveryEndpoint: "https://accounts.google.com/.well-known/openid-configuration",
          pkce: true,
        }),
        samlConfig: null,
      },
    ]);
    mocks.getAuthDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ all }),
    });

    const providers = await listStoredWorkspaceSSOProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]?.providerId).toBe("sqlite-google");
  });

  it("throws when neither a Postgres pool nor a SQLite database is configured for listing", async () => {
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.getAuthDatabase.mockReturnValue(null);

    await expect(listStoredWorkspaceSSOProviders()).rejects.toThrow(
      /No database configured for SSO provider listing/,
    );
  });
});
