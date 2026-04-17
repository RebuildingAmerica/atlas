import { beforeEach, describe, expect, it, vi } from "vitest";

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
  ensureAuthReady: vi.fn(),
  ensureAtlasSession: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: mocks.createServerFn,
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

vi.mock("@/domains/access/server/session-state", () => ({
  requireAtlasSessionState: mocks.ensureAtlasSession,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/request-headers", () => ({
  getBrowserSessionHeaders: mocks.getBrowserSessionHeaders,
}));

describe("passkeys.functions", () => {
  const browserSessionHeaders = new Headers({
    cookie: "better-auth.session_token=test-token",
  });

  beforeEach(() => {
    vi.resetModules();
    mocks.ensureAuthReady.mockReset();
    mocks.ensureAtlasSession.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.getBrowserSessionHeaders.mockReset();

    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
    });
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
  });

  it("returns an empty list while auth is disabled", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: true,
    });

    const { listPasskeys } = await import("@/domains/access/passkeys.functions");

    const response = (await listPasskeys.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual([]);
    expect(mocks.ensureAtlasSession).not.toHaveBeenCalled();
  });

  it("normalizes passkey timestamps into strings", async () => {
    const listPasskeysMock = vi.fn().mockResolvedValue([
      {
        createdAt: new Date("2026-04-10T00:00:00.000Z"),
        id: "pk_123",
        name: "MacBook",
      },
      {
        createdAt: "2026-04-11T00:00:00.000Z",
        id: "pk_456",
        name: "Phone",
      },
    ]);

    mocks.ensureAtlasSession.mockResolvedValue({
      user: { id: "user_123" },
    });
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        listPasskeys: listPasskeysMock,
      },
    });

    const { listPasskeys } = await import("@/domains/access/passkeys.functions");
    const response = (await listPasskeys.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual([
      {
        createdAt: "2026-04-10T00:00:00.000Z",
        id: "pk_123",
        name: "MacBook",
      },
      {
        createdAt: "2026-04-11T00:00:00.000Z",
        id: "pk_456",
        name: "Phone",
      },
    ]);
  });

  it("returns an empty list when Better Auth has no passkeys yet", async () => {
    const listPasskeysMock = vi.fn().mockResolvedValue(null);

    mocks.ensureAtlasSession.mockResolvedValue({
      user: { id: "user_123" },
    });
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        listPasskeys: listPasskeysMock,
      },
    });

    const { listPasskeys } = await import("@/domains/access/passkeys.functions");
    const response = (await listPasskeys.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual([]);
  });

  it("deletes a passkey with browser-session headers", async () => {
    const deletePasskeyMock = vi.fn().mockResolvedValue(undefined);

    mocks.ensureAtlasSession.mockResolvedValue({
      user: { id: "user_123" },
    });
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        deletePasskey: deletePasskeyMock,
      },
    });

    const { deletePasskey } = await import("@/domains/access/passkeys.functions");
    const response = (await deletePasskey.__executeServer({
      method: "POST",
      data: {
        id: "pk_123",
      },
    })) as ServerFnResponse;

    expect(response.error).toBeUndefined();
    expect(deletePasskeyMock).toHaveBeenCalledWith({
      body: {
        id: "pk_123",
      },
      headers: browserSessionHeaders,
    });
  });

  it("updates a passkey name with browser-session headers", async () => {
    const updatePasskeyMock = vi.fn().mockResolvedValue(undefined);

    mocks.ensureAtlasSession.mockResolvedValue({
      user: { id: "user_123" },
    });
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        updatePasskey: updatePasskeyMock,
      },
    });

    const { updatePasskey } = await import("@/domains/access/passkeys.functions");
    const response = (await updatePasskey.__executeServer({
      method: "POST",
      data: {
        id: "pk_123",
        name: "Desk Key",
      },
    })) as ServerFnResponse;

    expect(response.error).toBeUndefined();
    expect(updatePasskeyMock).toHaveBeenCalledWith({
      body: {
        id: "pk_123",
        name: "Desk Key",
      },
      headers: browserSessionHeaders,
    });
  });
});
