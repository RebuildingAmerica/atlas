import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listStoredWorkspaceSSOProviders,
  loadStoredWorkspaceIdentity,
} from "@/domains/access/server/sso-provider-store";

const mocks = vi.hoisted(() => {
  const pool = { query: vi.fn() };
  return {
    pool,
    getAuthPgPool: vi.fn(() => pool),
    getAuthRuntimeConfig: vi.fn(),
  };
});

vi.mock("@/domains/access/server/auth", () => ({
  getAuthPgPool: mocks.getAuthPgPool,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

describe("sso-provider-store", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.pool.query.mockReset();
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
});
