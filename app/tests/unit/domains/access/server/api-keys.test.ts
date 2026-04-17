import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAtlasSession: vi.fn(),
  ensureReadyAtlasSession: vi.fn(),
  ensureAuthReady: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  validateAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

vi.mock("@/domains/access/server/session-state", () => ({
  requireAtlasSessionState: mocks.ensureAtlasSession,
  requireReadyAtlasSessionState: mocks.ensureReadyAtlasSession,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
  validateAuthRuntimeConfig: mocks.validateAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/request-headers", () => ({
  getBrowserSessionHeaders: mocks.getBrowserSessionHeaders,
}));

describe("auth api-key server functions", () => {
  const browserSessionHeaders = new Headers({
    cookie: "better-auth.session_token=test-token",
  });
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    mocks.ensureAtlasSession.mockReset();
    mocks.ensureReadyAtlasSession.mockReset();
    mocks.ensureAuthReady.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.getBrowserSessionHeaders.mockReset();
    mocks.validateAuthRuntimeConfig.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    mocks.getAuthRuntimeConfig.mockReturnValue({
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api/auth/internal/api-key",
      localMode: false,
      internalSecret: "internal-test-secret",
    });
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.validateAuthRuntimeConfig.mockReturnValue(undefined);
  });

  it("unwraps Better Auth's list envelope into Atlas API-key records", async () => {
    const listApiKeysMock = vi.fn().mockResolvedValue({
      apiKeys: [
        {
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
          id: "key_123",
          name: "CLI key",
          permissions: {
            discovery: ["read"],
          },
          prefix: "atlas_",
          start: "atlas_abcd",
        },
      ],
      total: 1,
    });

    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        listApiKeys: listApiKeysMock,
      },
    });

    const { listApiKeys } = await import("@/domains/access/api-keys.functions");
    await listApiKeys();

    expect(listApiKeysMock).toHaveBeenCalledWith({
      headers: browserSessionHeaders,
    });
  });

  it("creates API keys without sending metadata into Better Auth", async () => {
    const createApiKeyMock = vi.fn().mockResolvedValue({
      key: "atlas_secret_key_1234567890",
    });
    fetchMock.mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        valid: true,
      }),
      ok: true,
    });

    mocks.ensureReadyAtlasSession.mockResolvedValue({
      user: {
        email: "operator@atlas.test",
        id: "user_123",
      },
    });
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        createApiKey: createApiKeyMock,
      },
    });

    const { createApiKey } = await import("@/domains/access/api-keys.functions");
    await createApiKey({
      data: {
        name: "CLI key",
        scopes: ["discovery:read"],
      },
    });

    expect(createApiKeyMock).toHaveBeenCalledWith({
      body: {
        name: "CLI key",
        permissions: {
          discovery: ["read"],
        },
        userId: "user_123",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3100/api/auth/internal/api-key", {
      headers: {
        "x-api-key": "atlas_secret_key_1234567890",
        "x-atlas-internal-secret": "internal-test-secret",
      },
      method: "POST",
    });
  });
});
