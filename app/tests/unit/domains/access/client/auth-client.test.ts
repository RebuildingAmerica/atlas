import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthClient: vi.fn(() => ({ kind: "auth-client" })),
  getAuthConfig: vi.fn(() => ({})),
  magicLinkClient: vi.fn(() => ({ name: "magic-link" })),
  passkeyClient: vi.fn(() => ({ name: "passkey" })),
  apiKeyClient: vi.fn(() => ({ name: "api-key" })),
  oauthProviderClient: vi.fn(() => ({ name: "oauth-provider" })),
  organizationClient: vi.fn(() => ({ name: "organization" })),
  ssoClient: vi.fn(() => ({ name: "sso" })),
  lastLoginMethodClient: vi.fn(() => ({ name: "last-login-method" })),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: mocks.createAuthClient,
}));

vi.mock("better-auth/client/plugins", () => ({
  magicLinkClient: mocks.magicLinkClient,
  lastLoginMethodClient: mocks.lastLoginMethodClient,
  organizationClient: mocks.organizationClient,
}));

vi.mock("@better-auth/api-key/client", () => ({
  apiKeyClient: mocks.apiKeyClient,
}));

vi.mock("@better-auth/oauth-provider/client", () => ({
  oauthProviderClient: mocks.oauthProviderClient,
}));

vi.mock("@better-auth/passkey/client", () => ({
  passkeyClient: mocks.passkeyClient,
}));

vi.mock("@better-auth/sso/client", () => ({
  ssoClient: mocks.ssoClient,
}));

vi.mock("../config", () => ({
  getAuthConfig: mocks.getAuthConfig,
}));

describe("getAuthClient", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createAuthClient.mockClear();
    mocks.getAuthConfig.mockReset();
  });

  it("initializes the Better Auth client with the Atlas plugins and base URL", async () => {
    mocks.getAuthConfig.mockReturnValue({
      authBaseUrl: "https://auth.atlas.test",
    });

    const { getAuthClient } = await import("@/domains/access/client/auth-client");
    const client = getAuthClient();

    expect(client).toEqual({ kind: "auth-client" });
    expect(mocks.createAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: expect.arrayContaining([{ name: "magic-link" }]) as unknown[],
      }),
    );
  });

  it("returns a singleton instance", async () => {
    mocks.getAuthConfig.mockReturnValue({});

    const { getAuthClient } = await import("@/domains/access/client/auth-client");
    const first = getAuthClient();
    const second = getAuthClient();

    expect(second).toBe(first);
    expect(mocks.createAuthClient).toHaveBeenCalledTimes(1);
  });
});
