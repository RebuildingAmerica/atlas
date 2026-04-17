import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ServerFnResponse {
  context: unknown;
  error: unknown;
  result: unknown;
}
interface ParsedValidator {
  parse(input: unknown): unknown;
}
type ServerFnResult =
  | Promise<ServerFnResponse["result"]>
  | object
  | string
  | number
  | boolean
  | null
  | undefined;

const mocks = vi.hoisted(() => ({
  createServerFn: (() => {
    return () => {
      let validateInput: ((input: unknown) => unknown) | undefined;

      const builder = {
        inputValidator(validator: ParsedValidator | ((input: unknown) => unknown)) {
          validateInput =
            typeof validator === "function" ? validator : (input) => validator.parse(input);
          return builder;
        },
        middleware() {
          return builder;
        },
        handler(handler: (input: { data: unknown }) => ServerFnResult) {
          const execute = (input?: { data?: unknown }) =>
            Promise.resolve(
              handler({
                data: validateInput ? validateInput(input?.data) : input?.data,
              }),
            );

          return Object.assign(async (input?: { data?: unknown }) => execute(input), {
            __executeServer: async (
              input: {
                method?: string;
                data?: unknown;
                headers?: HeadersInit;
                context?: unknown;
              } = {},
            ): Promise<ServerFnResponse> => {
              try {
                return {
                  context: input?.context,
                  error: undefined,
                  result: await execute(input),
                };
              } catch (error) {
                return {
                  context: input?.context,
                  error,
                  result: undefined,
                };
              }
            },
          });
        },
      };

      return builder;
    };
  })(),
  ensureAtlasSession: vi.fn(),
  ensureReadyAtlasSession: vi.fn(),
  ensureAuthReady: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  validateAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: mocks.createServerFn,
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

describe("api-keys.functions", () => {
  const browserSessionHeaders = new Headers({
    cookie: "better-auth.session_token=test-token",
  });
  const fetchMock = vi.fn();

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
    })) as ServerFnResponse;

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
    })) as ServerFnResponse;

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
    })) as ServerFnResponse;

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

    const createApiKeyMock = vi.fn().mockResolvedValue({
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
    mocks.ensureReadyAtlasSession.mockResolvedValue({
      user: {
        email: "operator@atlas.test",
        id: "user_123",
      },
    });
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
    })) as ServerFnResponse;

    expect(response.error).toBeUndefined();
    expect(deleteApiKeyMock).toHaveBeenCalledWith({
      body: {
        keyId: "key_123",
      },
      headers: browserSessionHeaders,
    });
  });
});
