import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BetterAuthOptions } from "better-auth";
import type { ApiKeyOptions as ApiKeyPluginOptions } from "@better-auth/api-key";
import type { OAuthOptions as OAuthProviderOptions } from "@better-auth/oauth-provider";
import type { PasskeyOptions as PasskeyPluginOptions } from "@better-auth/passkey";
import type { SCIMOptions } from "@better-auth/scim";
import type { MagicLinkOptions as MagicLinkPluginOptions } from "better-auth/plugins/magic-link";
import { buildScimTokenAuthorizationPayload } from "../../../../fixtures/access/scim-token-authorization";
import { buildAtprotoSignInContext, findAtprotoSignInHandler } from "./auth-runtime-test-support";

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
  isInstanceOperatorEmail: vi.fn(),
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
  isInstanceOperatorEmail: mocks.isInstanceOperatorEmail,
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
    mocks.isInstanceOperatorEmail.mockReset();
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
      instanceOperatorEmails: new Set(["operator@atlas.test"]),
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

  it("issues candidate bearer tokens with the existing API issuer and resource", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      operatorAllowedEmails: new Set(),
      localMode: false,
      apiKeyIntrospectionUrl: "https://candidate.atlas.test/api/auth/internal/api-key",
      dbPath: "/tmp/atlas/auth/atlas-auth.sqlite",
      internalSecret: "internal-test-secret",
      emailProvider: "capture",
      captureUrl: "http://127.0.0.1:8025/messages",
      emailFrom: "Atlas <auth@atlas.test>",
      publicDomain: "candidate.atlas.test",
      resendApiKey: null,
      publicBaseUrl: "https://candidate.atlas.test",
      canonicalBaseUrl: "https://atlas.test",
      authJwtAudience: "https://atlas.test/mcp",
      authJwtAudiences: ["https://atlas.test/mcp"],
    });
    const mod = await import("@/domains/access/server/auth");
    await mod.getAuth();
    expect(mocks.jwt.mock.calls[0]?.[0]).toMatchObject({
      jwt: {
        issuer: "https://atlas.test/api/auth",
        audience: "https://atlas.test/mcp",
      },
    });
    expect(mocks.betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://candidate.atlas.test" }),
    );
  });

  it("builds Better Auth once with the Atlas database, plugins, and email callbacks", async () => {
    const mod = await import("@/domains/access/server/auth");
    const auth = await mod.getAuth();
    const secondAuth = await mod.getAuth();

    expect(secondAuth).toBe(auth);
    expect(mocks.validateAuthRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(mocks.mkdirSync).toHaveBeenCalledWith("/tmp/atlas/auth", {
      recursive: true,
    });
    const databaseHandle = mocks.databaseInstances[0];
    expect(databaseHandle).toBeDefined();
    if (!databaseHandle) {
      throw new TypeError("Expected Better Auth to initialize a database handle.");
    }

    expect(databaseHandle.pragma).toHaveBeenCalledWith("journal_mode = WAL");

    const betterAuthCall = mocks.betterAuth.mock.calls.at(0);
    const typedOptions = betterAuthCall?.[0];
    expect(typedOptions).toBeDefined();
    if (!typedOptions) {
      throw new TypeError("Expected Better Auth to be configured.");
    }
    expect(typedOptions.appName).toBe("Atlas");
    expect(typedOptions.basePath).toBe("/api/auth");
    expect(typedOptions.baseURL).toBe("https://atlas.test");
    expect(typedOptions.secret).toBe("internal-test-secret");
    expect(typedOptions.trustedOrigins).toEqual([
      "https://atlas.test",
      "https://accounts.google.com",
      "https://oauth2.googleapis.com",
      "https://openidconnect.googleapis.com",
      "https://www.googleapis.com",
    ]);
    expect((typedOptions.plugins ?? []).length).toBeGreaterThanOrEqual(6);
    // Atlas has no Better Auth admin role: operator authority lives in the API's
    // authorization policy, so the admin plugin's impersonation and role
    // endpoints must not exist.
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.jwt).toHaveBeenCalledTimes(1);
    expect(mocks.passkey).toHaveBeenCalledWith({
      rpID: "atlas.test",
      rpName: "Atlas",
    });
    expect(mocks.apiKey).toHaveBeenCalledWith({
      defaultKeyLength: 40,
      enableSessionForAPIKeys: false,
      rateLimit: {
        enabled: false,
      },
    });

    if (!typedOptions.emailVerification?.sendVerificationEmail) {
      throw new TypeError("Expected the Better Auth wiring to register sendVerificationEmail.");
    }
    await typedOptions.emailVerification.sendVerificationEmail({
      url: "https://atlas.test/setup",
      user: { email: "operator@atlas.test" } as Parameters<
        NonNullable<typeof typedOptions.emailVerification.sendVerificationEmail>
      >[0]["user"],
      token: "verification-token",
    });
    expect(mocks.emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Verify your Atlas email",
        text: "Verify your email for Atlas: https://atlas.test/setup",
        to: "operator@atlas.test",
      }),
    );

    mocks.isInstanceOperatorEmail.mockReturnValue(true);
    const magicLinkCall = mocks.magicLink.mock.calls.at(0);
    const typedMagicLinkOptions = magicLinkCall?.[0];
    expect(typedMagicLinkOptions).toBeDefined();
    if (!typedMagicLinkOptions) {
      throw new TypeError("Expected the Better Auth magic-link plugin to be configured.");
    }
    expect(typedMagicLinkOptions).not.toHaveProperty("allowedAttempts");
    await typedMagicLinkOptions.sendMagicLink({
      email: "operator@atlas.test",
      url: "https://atlas.test/sign-in",
      token: "magic-link-token",
    });
    expect(mocks.emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Sign in to Atlas",
        text: "Use this link to sign in to Atlas: https://atlas.test/sign-in",
        to: "operator@atlas.test",
      }),
    );

    const oauthProviderCall = mocks.oauthProvider.mock.calls.at(0);
    const typedOauthProviderOptions = oauthProviderCall?.[0];
    expect(typedOauthProviderOptions).toBeDefined();
    if (!typedOauthProviderOptions) {
      throw new TypeError("Expected the OAuth provider plugin to be configured.");
    }
    expect(typedOauthProviderOptions.validAudiences).toBeUndefined();
    expect(typedOauthProviderOptions.scopes).toContain("api.mcp");
    expect(typedOauthProviderOptions.silenceWarnings?.oauthAuthServerConfig).toBe(true);

    const ssoCall = mocks.sso.mock.calls.at(0);
    const ssoOptions = ssoCall?.[0];
    expect(ssoOptions).toBeDefined();
    expect(ssoOptions).toMatchObject({
      disableImplicitSignUp: true,
      domainVerification: {
        enabled: true,
      },
      organizationProvisioning: {
        defaultRole: "member",
        disabled: false,
      },
      redirectURI: "/sso/callback",
    });
  });

  it("registers SCIM as an Atlas Team-only organization capability", async () => {
    const mod = await import("@/domains/access/server/auth");
    await mod.getAuth();

    const scimOptions = mocks.scim.mock.calls.at(0)?.[0];
    expect(scimOptions).toBeDefined();
    if (!scimOptions?.canGenerateToken) {
      throw new TypeError("Expected the SCIM plugin to include a token authorization hook.");
    }

    expect(scimOptions).toMatchObject({
      linkExistingUsers: {
        requireExistingOrgMembership: true,
      },
      requiredRole: ["admin", "owner"],
      storeSCIMToken: "hashed",
    });

    mocks.queryActiveProducts.mockResolvedValueOnce(["atlas_team"]);
    await expect(
      scimOptions.canGenerateToken(buildScimTokenAuthorizationPayload("org_team")),
    ).resolves.toBe(true);

    mocks.queryActiveProducts.mockResolvedValueOnce(["atlas_research_pass"]);
    await expect(
      scimOptions.canGenerateToken(buildScimTokenAuthorizationPayload("org_research")),
    ).resolves.toBe(false);

    await expect(
      scimOptions.canGenerateToken(buildScimTokenAuthorizationPayload(undefined)),
    ).resolves.toBe(false);
  });

  it("runs Better Auth migrations only once per process", async () => {
    const mod = await import("@/domains/access/server/auth");

    const first = await mod.ensureAuthReady();
    const second = await mod.ensureAuthReady();

    expect(second).toBe(first);
    expect(mocks.runMigrations).toHaveBeenCalledTimes(1);
  });

  it("creates a distinct auth instance per Workers request without changing Node singleton behavior", async () => {
    const mod = await import("@/domains/access/server/auth");
    const { runWorkerRequest } = await import("../../../../../server/request-scope");
    const instances: unknown[] = [];
    for (const name of ["a", "b"])
      await runWorkerRequest("postgres://" + name, async () => {
        const first = await mod.getAuth();
        expect(await mod.getAuth()).toBe(first);
        instances.push(first);
        return new Response(null, { status: 204 });
      });
    expect(mocks.betterAuth).toHaveBeenCalledTimes(2);
    expect(instances).toHaveLength(2);
  });

  it("checks the deployed schema instead of running migrations in external mode", async () => {
    vi.stubEnv("ATLAS_AUTH_MIGRATIONS", "external");
    const schema = await import("../../../../../server/auth-schema");
    const check = vi.spyOn(schema, "verifyAuthSchema").mockResolvedValue(undefined);
    const mod = await import("@/domains/access/server/auth");
    expect(await mod.ensureAuthReady()).toBe(await mod.ensureAuthReady());
    expect(check).toHaveBeenCalledTimes(1);
    expect(mocks.runMigrations).not.toHaveBeenCalled();
    check.mockRestore();
  });

  it("checks schema once within each Workers request", async () => {
    vi.stubEnv("ATLAS_AUTH_MIGRATIONS", "external");
    const schema = await import("../../../../../server/auth-schema");
    const check = vi.spyOn(schema, "verifyAuthSchema").mockResolvedValue(undefined);
    const mod = await import("@/domains/access/server/auth");
    const { runWorkerRequest } = await import("../../../../../server/request-scope");
    await runWorkerRequest("postgres://a", async () => {
      expect(await mod.ensureAuthReady()).toBe(await mod.ensureAuthReady());
      return new Response(null, { status: 204 });
    });
    expect(check).toHaveBeenCalledTimes(1);
    expect(mocks.runMigrations).not.toHaveBeenCalled();
    check.mockRestore();
  });

  describe("ATProto sign-in endpoint", () => {
    beforeEach(async () => {
      const mod = await import("@/domains/access/server/auth");
      await mod.getAuth();
    });

    it("issues a browser session for a verified account that holds a passkey", async () => {
      const handler = findAtprotoSignInHandler(mocks.betterAuth.mock.calls.at(0)?.[0]?.plugins);
      const ctx = buildAtprotoSignInContext("user_1");

      await expect(handler(ctx)).resolves.toEqual({ data: null, init: { status: 204 } });
      expect(mocks.setSessionCookie).toHaveBeenCalledWith(ctx, {
        session: { id: "session_1" },
        user: { emailVerified: true, id: "user_1" },
      });
    });

    it("refuses a call that arrived over HTTP instead of the server-side callback", async () => {
      const handler = findAtprotoSignInHandler(mocks.betterAuth.mock.calls.at(0)?.[0]?.plugins);
      const ctx = buildAtprotoSignInContext("user_1", {
        request: new Request("https://atlas.test/api/auth/internal/atproto-sign-in"),
      });

      await expect(handler(ctx)).rejects.toThrow("FORBIDDEN: ATProto sign-in is unavailable.");
      expect(ctx.context.internalAdapter.findUserById).not.toHaveBeenCalled();
      expect(mocks.setSessionCookie).not.toHaveBeenCalled();
    });

    it("refuses to sign in an unknown, unverified, or passkey-less account", async () => {
      const handler = findAtprotoSignInHandler(mocks.betterAuth.mock.calls.at(0)?.[0]?.plugins);

      for (const options of [
        { user: null },
        { user: { emailVerified: false, id: "user_1" } },
        { passkeys: [] },
      ]) {
        await expect(handler(buildAtprotoSignInContext("user_1", options))).rejects.toThrow(
          "UNAUTHORIZED: ATProto sign-in is unavailable.",
        );
      }
      expect(mocks.setSessionCookie).not.toHaveBeenCalled();
    });

    it("refuses to report success when the session could not be created", async () => {
      const handler = findAtprotoSignInHandler(mocks.betterAuth.mock.calls.at(0)?.[0]?.plugins);

      await expect(handler(buildAtprotoSignInContext("user_1", { session: null }))).rejects.toThrow(
        "UNAUTHORIZED: ATProto sign-in is unavailable.",
      );
      expect(mocks.setSessionCookie).not.toHaveBeenCalled();
    });
  });
});
