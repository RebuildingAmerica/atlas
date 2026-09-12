import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BetterAuthOptions } from "better-auth";
import type { ApiKeyOptions as ApiKeyPluginOptions } from "@better-auth/api-key";
import type { OAuthOptions as OAuthProviderOptions } from "@better-auth/oauth-provider";
import type { PasskeyOptions as PasskeyPluginOptions } from "@better-auth/passkey";
import type { SCIMOptions } from "@better-auth/scim";
import type { MagicLinkOptions as MagicLinkPluginOptions } from "better-auth/plugins/magic-link";

const mocks = vi.hoisted(() => ({
  resolvePrimaryWorkspaceId: vi.fn(),
  setSessionCookie: vi.fn(),
  admin: vi.fn(() => ({ kind: "admin" })),
  apiKey: vi.fn((options: ApiKeyPluginOptions) => ({ kind: "api-key", options })),
  bearer: vi.fn(() => ({ kind: "bearer" })),
  betterAuth: vi.fn<(options: BetterAuthOptions) => unknown>(),
  createEmailService: vi.fn(),
  emailSend: vi.fn(),
  databaseInstances: [] as {
    exec: ReturnType<typeof vi.fn>;
    pragma: ReturnType<typeof vi.fn>;
    prepare: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  }[],
  Database: class MockDatabase {
    exec = vi.fn();
    pragma = vi.fn();
    prepare = vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(undefined),
      run: vi.fn(),
    });
    transaction = vi.fn((fn: () => void) => fn);

    constructor(_path: string) {
      mocks.databaseInstances.push(this);
    }
  },
  isOperatorAllowedEmail: vi.fn(),
  deviceAuthorization: vi.fn((options: Record<string, unknown>) => ({
    kind: "device-authorization",
    options,
  })),
  organization: vi.fn((options: Record<string, unknown>) => ({ kind: "organization", options })),
  magicLink: vi.fn((options: MagicLinkPluginOptions) => ({ kind: "magic-link", options })),
  mkdirSync: vi.fn(),
  jwt: vi.fn((options: Record<string, unknown>) => ({ kind: "jwt", options })),
  oauthProvider: vi.fn((options: OAuthProviderOptions) => ({ kind: "oauth-provider", options })),
  passkey: vi.fn((options: PasskeyPluginOptions) => ({ kind: "passkey", options })),
  queryActiveProducts: vi.fn(),
  runMigrations: vi.fn(),
  scim: vi.fn((options: SCIMOptions) => ({ kind: "scim", options })),
  sso: vi.fn((options: Record<string, unknown>) => ({ kind: "sso", options })),
  tanstackStartCookies: vi.fn(() => ({ kind: "cookies" })),
  validateAuthRuntimeConfig: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: mocks.mkdirSync,
  },
  mkdirSync: mocks.mkdirSync,
}));

vi.mock("better-sqlite3", () => ({
  default: mocks.Database,
}));

vi.mock("better-auth", () => ({
  betterAuth: mocks.betterAuth,
}));

// Unwrap Better Auth's endpoint wrapper so the Atlas handler can be driven
// directly with a request context.
vi.mock("better-auth/api", () => ({
  createAuthEndpoint: (
    path: string,
    options: unknown,
    handler: (ctx: unknown) => Promise<unknown>,
  ) => Object.assign(handler, { options, path }),
}));

vi.mock("better-auth/cookies", () => ({
  setSessionCookie: mocks.setSessionCookie,
}));

vi.mock("better-auth/plugins/magic-link", () => ({
  magicLink: mocks.magicLink,
}));

vi.mock("better-auth/plugins/jwt", () => ({
  jwt: mocks.jwt,
}));

vi.mock("better-auth/plugins", () => ({
  admin: mocks.admin,
  bearer: mocks.bearer,
  deviceAuthorization: mocks.deviceAuthorization,
  organization: mocks.organization,
}));

vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: mocks.oauthProvider,
}));

vi.mock("@better-auth/sso", () => ({
  sso: mocks.sso,
}));

vi.mock("better-auth/tanstack-start", () => ({
  tanstackStartCookies: mocks.tanstackStartCookies,
}));

vi.mock("@better-auth/api-key", () => ({
  apiKey: mocks.apiKey,
}));

vi.mock("@better-auth/passkey", () => ({
  passkey: mocks.passkey,
}));

vi.mock("@better-auth/scim", () => ({
  scim: mocks.scim,
}));

vi.mock("@/platform/email/server/service", () => ({
  createEmailService: mocks.createEmailService,
}));

vi.mock("@/domains/access/server/workspace-products", () => ({
  queryActiveProducts: mocks.queryActiveProducts,
}));

vi.mock("@/domains/access/server/workspace-lookup", () => ({
  resolvePrimaryWorkspaceId: mocks.resolvePrimaryWorkspaceId,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
  isOperatorAllowedEmail: mocks.isOperatorAllowedEmail,
  validateAuthRuntimeConfig: mocks.validateAuthRuntimeConfig,
}));

describe("auth runtime wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.admin.mockClear();
    mocks.apiKey.mockClear();
    mocks.bearer.mockClear();
    mocks.betterAuth.mockClear();
    mocks.createEmailService.mockReset();
    mocks.emailSend.mockReset();
    mocks.emailSend.mockResolvedValue(undefined);
    mocks.databaseInstances.length = 0;
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.isOperatorAllowedEmail.mockReset();
    mocks.deviceAuthorization.mockClear();
    mocks.jwt.mockClear();
    mocks.magicLink.mockClear();
    mocks.mkdirSync.mockReset();
    mocks.organization.mockClear();
    mocks.oauthProvider.mockClear();
    mocks.passkey.mockClear();
    mocks.queryActiveProducts.mockReset();
    mocks.resolvePrimaryWorkspaceId.mockReset();
    mocks.resolvePrimaryWorkspaceId.mockResolvedValue(null);
    mocks.runMigrations.mockReset();
    mocks.scim.mockClear();
    mocks.sso.mockClear();
    mocks.tanstackStartCookies.mockClear();
    mocks.validateAuthRuntimeConfig.mockReset();
    mocks.getAuthRuntimeConfig.mockReturnValue({
      operatorAllowedEmails: new Set(["operator@atlas.test"]),
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api/auth/internal/api-key",
      localMode: false,
      captureUrl: "http://127.0.0.1:8025/messages",
      dbPath: "/tmp/atlas/auth/atlas-auth.sqlite",
      emailFrom: "Atlas <auth@atlas.test>",
      emailProvider: "capture",
      internalSecret: "internal-test-secret",
      publicBaseUrl: "https://atlas.test",
      publicDomain: "atlas.test",
      resendApiKey: null,
    });
    mocks.validateAuthRuntimeConfig.mockReturnValue(undefined);
    mocks.queryActiveProducts.mockResolvedValue([]);
    mocks.createEmailService.mockReturnValue({
      send: mocks.emailSend,
    });
    mocks.betterAuth.mockImplementation(() => ({
      $context: Promise.resolve({
        runMigrations: mocks.runMigrations,
      }),
      api: {},
    }));
  });

  it("forwards configured API audiences and maps access-token scope claims", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      operatorAllowedEmails: new Set(["operator@atlas.test"]),
      authJwtAudience: "https://atlas.test/mcp",
      authJwtAudiences: ["https://atlas.test/mcp", "https://atlas.test/api"],
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api/auth/internal/api-key",
      localMode: false,
      captureUrl: "http://127.0.0.1:8025/messages",
      dbPath: "/tmp/atlas/auth/atlas-auth.sqlite",
      emailFrom: "Atlas <auth@atlas.test>",
      emailProvider: "capture",
      internalSecret: "internal-test-secret",
      publicBaseUrl: "https://atlas.test",
      publicDomain: "atlas.test",
      resendApiKey: null,
    });

    const mod = await import("@/domains/access/server/auth");
    await mod.getAuth();

    const oauthProviderCall = mocks.oauthProvider.mock.calls.at(0);
    const typedOauthProviderOptions = oauthProviderCall?.[0];
    expect(typedOauthProviderOptions).toBeDefined();
    if (!typedOauthProviderOptions?.customAccessTokenClaims) {
      throw new TypeError("Expected OAuth provider access-token claim mapping.");
    }

    expect(typedOauthProviderOptions.validAudiences).toEqual([
      "https://atlas.test/mcp",
      "https://atlas.test/api",
    ]);
    await expect(
      typedOauthProviderOptions.customAccessTokenClaims({
        scopes: [
          "openid",
          "discovery:write",
          "entities:write",
          "api.mcp",
          "admin:all",
        ] as Parameters<
          NonNullable<typeof typedOauthProviderOptions.customAccessTokenClaims>
        >[0]["scopes"],
      }),
    ).resolves.toEqual({
      // RFC 8707 audience binding falls back to authJwtAudience when the OAuth
      // client does not pass an explicit `resource` parameter.
      aud: "https://atlas.test/mcp",
      permissions: {
        discovery: ["write"],
        entities: ["write"],
      },
    });
  });

  it("binds the access token aud to the resource parameter when supplied (RFC 8707)", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      operatorAllowedEmails: new Set(["operator@atlas.test"]),
      authJwtAudience: "atlas-api",
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api/auth/internal/api-key",
      localMode: false,
      captureUrl: "http://127.0.0.1:8025/messages",
      dbPath: "/tmp/atlas/auth/atlas-auth.sqlite",
      emailFrom: "Atlas <auth@atlas.test>",
      emailProvider: "capture",
      internalSecret: "internal-test-secret",
      publicBaseUrl: "https://atlas.test",
      publicDomain: "atlas.test",
      resendApiKey: null,
    });

    const mod = await import("@/domains/access/server/auth");
    await mod.getAuth();

    const oauthProviderCall = mocks.oauthProvider.mock.calls.at(0);
    const typedOauthProviderOptions = oauthProviderCall?.[0];
    if (!typedOauthProviderOptions?.customAccessTokenClaims) {
      throw new TypeError("Expected OAuth provider access-token claim mapping.");
    }

    const claims = await typedOauthProviderOptions.customAccessTokenClaims({
      scopes: ["openid", "discovery:read"] as Parameters<
        NonNullable<typeof typedOauthProviderOptions.customAccessTokenClaims>
      >[0]["scopes"],
      resource: "https://atlas.test/mcp",
    });

    expect(claims.aud).toBe("https://atlas.test/mcp");
  });

  it("omits the workspace and audience claims when neither applies", async () => {
    const mod = await import("@/domains/access/server/auth");
    await mod.getAuth();

    const jwtOptions = mocks.jwt.mock.calls.at(0)?.[0] as
      | { jwt: { definePayload: (input: { user: { email: string; id: string } }) => unknown } }
      | undefined;
    if (!jwtOptions) {
      throw new TypeError("Expected the JWT plugin to be configured.");
    }

    await expect(
      jwtOptions.jwt.definePayload({ user: { email: "operator@atlas.test", id: "user_1" } }),
    ).resolves.toEqual({
      email: "operator@atlas.test",
      permissions: expect.any(Object) as object,
    });
    expect(mocks.resolvePrimaryWorkspaceId).toHaveBeenCalledWith("user_1");
  });

  it("stamps the signed-in workspace and API audience into the JWT", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      operatorAllowedEmails: new Set(["operator@atlas.test"]),
      authJwtAudience: "https://atlas.test/mcp",
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api/auth/internal/api-key",
      localMode: false,
      captureUrl: "http://127.0.0.1:8025/messages",
      dbPath: "/tmp/atlas/auth/atlas-auth.sqlite",
      emailFrom: "Atlas <auth@atlas.test>",
      emailProvider: "capture",
      internalSecret: "internal-test-secret",
      publicBaseUrl: "https://atlas.test",
      publicDomain: "atlas.test",
      resendApiKey: null,
    });
    mocks.resolvePrimaryWorkspaceId.mockResolvedValue("org_primary");

    const mod = await import("@/domains/access/server/auth");
    await mod.getAuth();

    const jwtOptions = mocks.jwt.mock.calls.at(0)?.[0] as
      | { jwt: { definePayload: (input: { user: { email: string; id: string } }) => unknown } }
      | undefined;
    if (!jwtOptions) {
      throw new TypeError("Expected the JWT plugin to be configured.");
    }

    await expect(
      jwtOptions.jwt.definePayload({ user: { email: "operator@atlas.test", id: "user_1" } }),
    ).resolves.toMatchObject({
      aud: "https://atlas.test/mcp",
      org_id: "org_primary",
    });
  });
});
