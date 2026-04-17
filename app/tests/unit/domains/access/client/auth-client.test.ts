import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiKeyClient: vi.fn(() => ({ kind: "api-key" })),
  createAuthClient: vi.fn(),
  getAuthConfig: vi.fn(),
  lastLoginMethodClient: vi.fn(() => ({ kind: "last-login-method" })),
  magicLinkClient: vi.fn(() => ({ kind: "magic-link" })),
  organizationClient: vi.fn(() => ({ kind: "organization" })),
  oauthProviderClient: vi.fn(() => ({ kind: "oauth-provider" })),
  passkeyClient: vi.fn(() => ({ kind: "passkey" })),
  ssoClient: vi.fn(() => ({ kind: "sso" })),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: mocks.createAuthClient,
}));

vi.mock("better-auth/client/plugins", () => ({
  lastLoginMethodClient: mocks.lastLoginMethodClient,
  magicLinkClient: mocks.magicLinkClient,
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

vi.mock("@/domains/access/config", () => ({
  getAuthConfig: mocks.getAuthConfig,
}));

describe("auth-client", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.apiKeyClient.mockClear();
    mocks.createAuthClient.mockReset();
    mocks.getAuthConfig.mockReset();
    mocks.lastLoginMethodClient.mockClear();
    mocks.magicLinkClient.mockClear();
    mocks.organizationClient.mockClear();
    mocks.oauthProviderClient.mockClear();
    mocks.passkeyClient.mockClear();
    mocks.ssoClient.mockClear();
    mocks.createAuthClient.mockReturnValue({ client: true });
  });

  it("builds and memoizes the browser auth client with an auth base url", async () => {
    mocks.getAuthConfig.mockReturnValue({
      authBaseUrl: "https://atlas.test/api/auth",
    });

    const { getAuthClient } = await import("@/domains/access/client/auth-client");
    const first = getAuthClient();
    const second = getAuthClient();

    expect(second).toBe(first);
    expect(mocks.createAuthClient).toHaveBeenCalledWith({
      baseURL: "https://atlas.test/api/auth",
      plugins: [
        { kind: "magic-link" },
        { kind: "passkey" },
        { kind: "api-key" },
        { kind: "oauth-provider" },
        { kind: "organization" },
        { kind: "sso" },
        { kind: "last-login-method" },
      ],
    });
  });

  it("omits the base url when auth is mounted on the default origin", async () => {
    mocks.getAuthConfig.mockReturnValue({
      authBaseUrl: undefined,
    });

    const { getAuthClient } = await import("@/domains/access/client/auth-client");
    getAuthClient();

    expect(mocks.createAuthClient).toHaveBeenCalledWith({
      plugins: [
        { kind: "magic-link" },
        { kind: "passkey" },
        { kind: "api-key" },
        { kind: "oauth-provider" },
        { kind: "organization" },
        { kind: "sso" },
        { kind: "last-login-method" },
      ],
    });
  });
});
