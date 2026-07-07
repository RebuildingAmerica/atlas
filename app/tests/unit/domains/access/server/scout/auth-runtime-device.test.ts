import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiKey: vi.fn(() => ({ kind: "api-key" })),
  bearer: vi.fn(() => ({ kind: "bearer" })),
  betterAuth: vi.fn(),
  registeredClientIds: new Set<string>(),
  Database: class MockDatabase {
    pragma = vi.fn();
    prepare = vi.fn(() => ({
      get: (clientId: string) =>
        mocks.registeredClientIds.has(clientId) ? { disabled: 0 } : undefined,
    }));
  },
  deviceAuthorization: vi.fn((options: Record<string, unknown>) => ({
    kind: "device-authorization",
    options,
  })),
  getAuthRuntimeConfig: vi.fn(),
  jwt: vi.fn((options: Record<string, unknown>) => ({ kind: "jwt", options })),
  magicLink: vi.fn(() => ({ kind: "magic-link" })),
  mkdirSync: vi.fn(),
  oauthProvider: vi.fn(() => ({ kind: "oauth-provider" })),
  organization: vi.fn(() => ({ kind: "organization" })),
  passkey: vi.fn(() => ({ kind: "passkey" })),
  resolvePrimaryWorkspaceId: vi.fn(),
  runMigrations: vi.fn(),
  sso: vi.fn(() => ({ kind: "sso" })),
  tanstackStartCookies: vi.fn(() => ({ kind: "cookies" })),
  validateAuthRuntimeConfig: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: { mkdirSync: mocks.mkdirSync },
  mkdirSync: mocks.mkdirSync,
}));

vi.mock("better-sqlite3", () => ({ default: mocks.Database }));
vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/plugins", () => ({
  bearer: mocks.bearer,
  deviceAuthorization: mocks.deviceAuthorization,
  organization: mocks.organization,
}));
vi.mock("better-auth/plugins/jwt", () => ({ jwt: mocks.jwt }));
vi.mock("better-auth/plugins/magic-link", () => ({ magicLink: mocks.magicLink }));
vi.mock("@better-auth/api-key", () => ({ apiKey: mocks.apiKey }));
vi.mock("@better-auth/oauth-provider", () => ({ oauthProvider: mocks.oauthProvider }));
vi.mock("@better-auth/passkey", () => ({ passkey: mocks.passkey }));
vi.mock("@better-auth/sso", () => ({ sso: mocks.sso }));
vi.mock("better-auth/tanstack-start", () => ({
  tanstackStartCookies: mocks.tanstackStartCookies,
}));
vi.mock("@/platform/email/server/service", () => ({
  createEmailService: vi.fn(() => ({ send: vi.fn() })),
}));
vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
  isAllowedEmail: vi.fn(),
  validateAuthRuntimeConfig: mocks.validateAuthRuntimeConfig,
}));
vi.mock("@/domains/access/server/workspace-lookup", () => ({
  resolvePrimaryWorkspaceId: mocks.resolvePrimaryWorkspaceId,
}));

describe("OAuth device auth runtime wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.apiKey.mockClear();
    mocks.bearer.mockClear();
    mocks.betterAuth.mockReset();
    mocks.deviceAuthorization.mockClear();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.registeredClientIds.clear();
    mocks.jwt.mockClear();
    mocks.mkdirSync.mockReset();
    mocks.resolvePrimaryWorkspaceId.mockReset();
    mocks.runMigrations.mockReset();
    mocks.validateAuthRuntimeConfig.mockReset();
    mocks.getAuthRuntimeConfig.mockReturnValue({
      allowedEmails: new Set(["operator@atlas.test"]),
      authJwtAudience: "https://atlas.test/api",
      authJwtAudiences: ["https://atlas.test/api"],
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api/auth/internal/api-key",
      captureUrl: "http://127.0.0.1:8025/messages",
      dbPath: "/tmp/atlas/auth/atlas-auth.sqlite",
      emailFrom: "Atlas <auth@atlas.test>",
      emailProvider: "capture",
      internalSecret: "internal-test-secret",
      localMode: false,
      publicBaseUrl: "https://atlas.test",
      publicDomain: "atlas.test",
      resendApiKey: null,
    });
    mocks.resolvePrimaryWorkspaceId.mockResolvedValue(null);
    mocks.betterAuth.mockImplementation(() => ({
      $context: Promise.resolve({ runMigrations: mocks.runMigrations }),
      api: {},
    }));
  });

  it("registers a browser-approved device flow for registered OAuth clients", async () => {
    const mod = await import("@/domains/access/server/auth");
    await mod.getAuth();

    expect(mocks.bearer).toHaveBeenCalledTimes(1);
    const options = mocks.deviceAuthorization.mock.calls.at(0)?.[0] as
      | {
          expiresIn?: string;
          interval?: string;
          validateClient?: (clientId: string) => boolean | Promise<boolean>;
          verificationUri?: string;
        }
      | undefined;
    expect(options?.expiresIn).toBe("30m");
    expect(options?.interval).toBe("5s");
    expect(options?.verificationUri).toBe("/device");
    expect(typeof options?.validateClient).toBe("function");

    mocks.registeredClientIds.add("example-oauth-client");
    await expect(options?.validateClient?.("example-oauth-client")).resolves.toBe(true);
    await expect(options?.validateClient?.("unknown-client")).resolves.toBe(false);
  });

  it("mints API JWTs with Atlas discovery write permissions", async () => {
    mocks.resolvePrimaryWorkspaceId.mockResolvedValue("org-123");
    const mod = await import("@/domains/access/server/auth");
    await mod.getAuth();

    const options = mocks.jwt.mock.calls.at(0)?.[0] as
      | {
          jwt?: {
            definePayload?: (session: {
              user: { id: string; email: string };
            }) => Promise<Record<string, unknown>> | Record<string, unknown>;
          };
        }
      | undefined;
    const payload = await options?.jwt?.definePayload?.({
      user: { id: "user-123", email: "operator@atlas.test" },
    });

    expect(payload).toEqual({
      aud: "https://atlas.test/api",
      email: "operator@atlas.test",
      permissions: {
        discovery: ["read", "write"],
        entities: ["write"],
        firehose: ["read"],
      },
      org_id: "org-123",
    });
  });
});
