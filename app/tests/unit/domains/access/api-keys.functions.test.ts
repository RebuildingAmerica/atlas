import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";
import type { CreateApiKeyMock } from "../../../helpers/access/api-key-mock";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  ensureAtlasSession: vi.fn(),
  ensureReadyAtlasSession: vi.fn(),
  ensureAuthReady: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  validateAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

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

describe("api-keys.functions", () => {
  const browserSessionHeaders = new Headers({
    cookie: "better-auth.session_token=test-token",
  });
  const fetchMock = vi.fn();
  const apiKeyEnabledCapabilities = {
    capabilities: ["research.run", "api.keys"] as const,
    limits: {
      research_runs_per_month: 2,
      max_shortlists: 1,
      max_shortlist_entries: 25,
      max_api_keys: null,
      api_requests_per_day: 1000,
      public_api_requests_per_hour: 100,
      max_members: 1,
    },
  };

  type ApiKeySessionUserOverride = Partial<AtlasSessionPayload["user"]>;

  function createApiKeyEnabledSession(user: ApiKeySessionUserOverride = {}) {
    return createAtlasSessionFixture({
      user,
      workspace: createAtlasWorkspace({
        resolvedCapabilities: {
          capabilities: [...apiKeyEnabledCapabilities.capabilities],
          limits: apiKeyEnabledCapabilities.limits,
        },
      }),
    });
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    fetchMock.mockReset();
    mocks.ensureAtlasSession.mockReset();
    mocks.ensureReadyAtlasSession.mockReset();
    mocks.ensureAuthReady.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.getBrowserSessionHeaders.mockReset();
    mocks.validateAuthRuntimeConfig.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    mocks.getAuthRuntimeConfig.mockReturnValue({
      apiBaseUrl: "http://atlas-api.test",
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api/auth/internal/api-key",
      localMode: false,
      internalSecret: "internal-test-secret",
      publicBaseUrl: "http://atlas.test",
    });
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.validateAuthRuntimeConfig.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns an empty list while auth is disabled", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: true,
    });

    const { listApiKeys } = await import("@/domains/access/api-keys.functions");

    const response = (await listApiKeys.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual([]);
    expect(mocks.ensureAtlasSession).not.toHaveBeenCalled();
  });

  it("normalizes listed API keys when Better Auth already returns string timestamps", async () => {
    const listApiKeysMock = vi.fn().mockResolvedValue({
      apiKeys: [
        {
          createdAt: "2026-04-10T00:00:00.000Z",
          id: "key_123",
          name: "CLI key",
          permissions: null,
          prefix: null,
          start: "atlas_abcd",
        },
      ],
      total: 1,
    });

    mocks.ensureAtlasSession.mockResolvedValue({
      user: { id: "user_123" },
    });
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        listApiKeys: listApiKeysMock,
      },
    });

    const { listApiKeys } = await import("@/domains/access/api-keys.functions");
    const response = (await listApiKeys.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual([
      expect.objectContaining({
        createdAt: "2026-04-10T00:00:00.000Z",
        id: "key_123",
        name: "CLI key",
        permissions: null,
        prefix: "atlas_abcd",
        scopes: [],
        start: "atlas_abcd",
      }),
    ]);
  });

  it("falls back to a null prefix when Better Auth omits both prefix variants", async () => {
    const listApiKeysMock = vi.fn().mockResolvedValue({
      apiKeys: [
        {
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
          id: "key_456",
          name: "Missing prefix",
          permissions: null,
          prefix: null,
          start: null,
        },
      ],
      total: 1,
    });

    mocks.ensureAtlasSession.mockResolvedValue({
      user: { id: "user_123" },
    });
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        listApiKeys: listApiKeysMock,
      },
    });

    const { listApiKeys } = await import("@/domains/access/api-keys.functions");
    const response = (await listApiKeys.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual([
      expect.objectContaining({
        createdAt: "2026-04-10T00:00:00.000Z",
        id: "key_456",
        prefix: null,
      }),
    ]);
  });

  it("rejects API-key creation while auth is disabled", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: true,
    });

    const { createApiKey } = await import("@/domains/access/api-keys.functions");

    const response = await createApiKey.__executeServer({
      method: "POST",
      data: {
        name: "CLI key",
        scopes: ["discovery:read"],
      },
    });

    expect(response).toMatchObject({
      error: new Error("API keys are unavailable while auth is disabled."),
    });
  });

  it("waits for discovery-read API keys until the protected Atlas API accepts them", async () => {
    vi.useFakeTimers();

    const createApiKeyMock = vi.fn<CreateApiKeyMock>().mockResolvedValue({
      key: "atlas_secret_key_1234567890",
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
      })
      .mockRejectedValueOnce(new Error("temporary auth outage"))
      .mockResolvedValue({
        ok: true,
      });

    mocks.ensureReadyAtlasSession.mockResolvedValue(
      createApiKeyEnabledSession({
        email: "operator@atlas.test",
        id: "user_123",
      }),
    );
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        createApiKey: createApiKeyMock,
      },
    });

    const { createApiKey } = await import("@/domains/access/api-keys.functions");
    const createPromise = createApiKey.__executeServer({
      method: "POST",
      data: {
        name: "CLI key",
        scopes: ["discovery:read"],
      },
    });

    await vi.runAllTimersAsync();

    await expect(createPromise).resolves.toMatchObject({
      error: undefined,
      result: {
        key: "atlas_secret_key_1234567890",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://atlas-api.test/api/discovery-runs",
      expect.objectContaining({
        headers: {
          "x-api-key": "atlas_secret_key_1234567890",
        },
        method: "GET",
      }),
    );
    const createApiKeyRequest = createApiKeyMock.mock.calls[0]?.[0];
    if (!createApiKeyRequest) {
      throw new Error("Expected Better Auth API key creation.");
    }
    expect(createApiKeyRequest.body.metadata).toEqual({
      organizationId: "org_team",
      userEmail: "operator@atlas.test",
    });
    expect(createApiKeyRequest.body.userId).toBe("user_123");
  });

  it("deletes API keys with the current browser-session headers", async () => {
    const deleteApiKeyMock = vi.fn().mockResolvedValue(undefined);

    mocks.ensureAtlasSession.mockResolvedValue({
      user: { id: "user_123" },
    });
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        deleteApiKey: deleteApiKeyMock,
      },
    });

    const { deleteApiKey } = await import("@/domains/access/api-keys.functions");
    const response = (await deleteApiKey.__executeServer({
      method: "POST",
      data: {
        keyId: "key_123",
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(deleteApiKeyMock).toHaveBeenCalledWith({
      body: {
        keyId: "key_123",
      },
      headers: browserSessionHeaders,
    });
  });
});
