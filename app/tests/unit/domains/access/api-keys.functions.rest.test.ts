import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasSessionPayload } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
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

  it("rejects API-key creation when the workspace lacks API-key access", async () => {
    const createApiKeyMock = vi.fn().mockResolvedValue({
      key: "atlas_secret_key_1234567890",
    });
    mocks.ensureReadyAtlasSession.mockResolvedValue(
      createAtlasSessionFixture({
        workspace: createAtlasWorkspace({
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
        }),
      }),
    );
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        createApiKey: createApiKeyMock,
      },
    });

    const { createApiKey } = await import("@/domains/access/api-keys.functions");
    const response = (await createApiKey.__executeServer({
      method: "POST",
      data: {
        name: "CLI key",
        scopes: ["discovery:read"],
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toBe("This workspace cannot create Atlas API keys.");
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  it("rejects API-key creation when the workspace key limit is reached", async () => {
    const createApiKeyMock = vi.fn().mockResolvedValue({
      key: "atlas_secret_key_1234567890",
    });
    const listApiKeysMock = vi.fn().mockResolvedValue({
      apiKeys: [
        {
          createdAt: "2026-04-10T00:00:00.000Z",
          id: "key_existing",
          name: "Existing key",
          permissions: null,
          prefix: "atlas_1234",
        },
      ],
      total: 1,
    });
    mocks.ensureReadyAtlasSession.mockResolvedValue(
      createAtlasSessionFixture({
        workspace: createAtlasWorkspace({
          resolvedCapabilities: {
            capabilities: ["research.run", "api.keys"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 1,
              api_requests_per_day: 1000,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
        }),
      }),
    );
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        createApiKey: createApiKeyMock,
        listApiKeys: listApiKeysMock,
      },
    });

    const { createApiKey } = await import("@/domains/access/api-keys.functions");
    const response = (await createApiKey.__executeServer({
      method: "POST",
      data: {
        name: "CLI key",
        scopes: ["discovery:read"],
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toBe(
      "This workspace has reached its Atlas API key limit.",
    );
    expect(listApiKeysMock).toHaveBeenCalledWith({
      headers: browserSessionHeaders,
    });
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  it("issues a key when the workspace still has room under its key limit", async () => {
    const createApiKeyMock = vi.fn().mockResolvedValue({
      key: "atlas_secret_key_1234567890",
    });
    const listApiKeysMock = vi.fn().mockResolvedValue({
      apiKeys: [
        {
          createdAt: "2026-04-10T00:00:00.000Z",
          id: "key_existing",
          name: "Existing key",
          permissions: null,
          prefix: "atlas_1234",
        },
      ],
      total: 1,
    });
    fetchMock.mockResolvedValue({ ok: true });
    mocks.ensureReadyAtlasSession.mockResolvedValue(
      createAtlasSessionFixture({
        workspace: createAtlasWorkspace({
          resolvedCapabilities: {
            capabilities: ["research.run", "api.keys"],
            limits: {
              ...apiKeyEnabledCapabilities.limits,
              max_api_keys: 2,
            },
          },
        }),
      }),
    );
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        createApiKey: createApiKeyMock,
        listApiKeys: listApiKeysMock,
      },
    });

    const { createApiKey } = await import("@/domains/access/api-keys.functions");
    const response = (await createApiKey.__executeServer({
      method: "POST",
      data: {
        name: "CLI key",
        scopes: ["discovery:read"],
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ key: "atlas_secret_key_1234567890" });
    expect(createApiKeyMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to internal introspection for scope sets without a safe public probe", async () => {
    vi.useFakeTimers();

    const createApiKeyMock = vi.fn().mockResolvedValue({
      key: "atlas_secret_key_1234567890",
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
      })
      .mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          valid: true,
        }),
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
        scopes: ["entities:write"],
      },
    });

    await vi.runAllTimersAsync();

    await expect(createPromise).resolves.toMatchObject({
      error: undefined,
      result: {
        key: "atlas_secret_key_1234567890",
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3100/api/auth/internal/api-key",
      expect.objectContaining({
        headers: {
          "x-api-key": "atlas_secret_key_1234567890",
          "x-atlas-internal-secret": "internal-test-secret",
        },
        method: "POST",
      }),
    );
  });

  it("returns the new API key even when activation is still pending", async () => {
    vi.useFakeTimers();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      /* suppress */
    });
    mocks.ensureReadyAtlasSession.mockResolvedValue(
      createApiKeyEnabledSession({
        email: "operator@atlas.test",
        id: "user_123",
      }),
    );
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        createApiKey: vi.fn().mockResolvedValue({
          key: "atlas_secret_key_1234567890",
        }),
      },
    });
    fetchMock.mockResolvedValue({
      ok: false,
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
    expect(warnSpy).toHaveBeenCalledWith(
      "Atlas API key provisioning is still pending after creation.",
      expect.objectContaining({
        scopes: ["discovery:read"],
        userId: "user_123",
      }),
    );

    warnSpy.mockRestore();
  });

  it("returns created API keys immediately when Better Auth does not expose the secret value", async () => {
    const createApiKeyMock = vi.fn().mockResolvedValue({});

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
    const response = await createApiKey.__executeServer({
      method: "POST",
      data: {
        name: "CLI key",
        scopes: ["discovery:read"],
      },
    });

    expect(response).toMatchObject({
      error: undefined,
      result: {},
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the missing-introspection-URL error when no public probe is available", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      apiBaseUrl: "http://atlas-api.test",
      apiKeyIntrospectionUrl: null,
      localMode: false,
      internalSecret: "internal-test-secret",
      publicBaseUrl: "http://atlas.test",
    });
    mocks.ensureReadyAtlasSession.mockResolvedValue(
      createApiKeyEnabledSession({
        email: "operator@atlas.test",
        id: "user_123",
      }),
    );
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        createApiKey: vi.fn().mockResolvedValue({
          key: "atlas_secret_key_1234567890",
        }),
      },
    });

    const { createApiKey } = await import("@/domains/access/api-keys.functions");
    const response = (await createApiKey.__executeServer({
      method: "POST",
      data: {
        name: "CLI key",
        scopes: ["entities:write"],
      },
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeInstanceOf(Error);
    expect((response.error as Error).message).toContain(
      "ATLAS_AUTH_API_KEY_INTROSPECTION_URL is required",
    );
  });
  it("probes the public origin when no separate API base URL is configured", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      apiBaseUrl: null,
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api/auth/internal/api-key",
      internalSecret: "internal-test-secret",
      localMode: false,
      publicBaseUrl: "http://atlas.test",
    });
    mocks.ensureReadyAtlasSession.mockResolvedValue(
      createApiKeyEnabledSession({ email: "operator@atlas.test", id: "user_123" }),
    );
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        createApiKey: vi.fn().mockResolvedValue({ key: "atlas_secret_key_1234567890" }),
      },
    });
    fetchMock.mockResolvedValue({ ok: true });

    const { createApiKey } = await import("@/domains/access/api-keys.functions");
    const response = await createApiKey.__executeServer({
      method: "POST",
      data: { name: "CLI key", scopes: ["discovery:read"] },
    });

    expect(response).toMatchObject({ error: undefined });
    expect(fetchMock).toHaveBeenCalledWith("http://atlas.test/api/discovery-runs", {
      headers: { "x-api-key": "atlas_secret_key_1234567890" },
      method: "GET",
    });
  });

  it("refuses to list API keys from the browser bundle", async () => {
    vi.stubEnv("SSR", false);
    vi.resetModules();
    const { listApiKeys } = await import("@/domains/access/api-keys.functions");

    await expect(listApiKeys()).rejects.toThrow("Auth is only available on the server.");
  });

  it("refuses to create an API key from the browser bundle", async () => {
    vi.stubEnv("SSR", false);
    vi.resetModules();
    const { createApiKey } = await import("@/domains/access/api-keys.functions");

    await expect(
      createApiKey({ data: { name: "CLI key", scopes: ["discovery:read"] } }),
    ).rejects.toThrow("Auth runtime is only available on the server.");
  });

  it("refuses to delete an API key from the browser bundle", async () => {
    vi.stubEnv("SSR", false);
    vi.resetModules();
    const { deleteApiKey } = await import("@/domains/access/api-keys.functions");

    await expect(deleteApiKey({ data: { keyId: "key_456" } })).rejects.toThrow(
      "Auth is only available on the server.",
    );
  });
});
