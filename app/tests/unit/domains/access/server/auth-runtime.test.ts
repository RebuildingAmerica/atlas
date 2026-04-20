import { beforeEach, describe, expect, it, vi } from "vitest";

interface ApiKeyPluginOptions {
  defaultKeyLength: number;
  enableSessionForAPIKeys: boolean;
}

interface MagicLinkPluginOptions {
  sendMagicLink(input: { email: string; url: string }): Promise<void>;
}

interface OAuthProviderOptions {
  customAccessTokenClaims?(input: { scopes: string[] }): {
    permissions: Record<string, string[]>;
  };
  validAudiences?: string[];
}

interface PasskeyPluginOptions {
  rpID: string;
  rpName: string;
}

interface BetterAuthOptions {
  appName: string;
  basePath: string;
  baseURL: string;
  database: unknown;
  emailVerification: {
    sendVerificationEmail(input: { url: string; user: { email: string } }): Promise<void>;
  };
  plugins: unknown[];
  secret: string;
  trustedOrigins: string[];
}

const mocks = vi.hoisted(() => ({
  apiKey: vi.fn((options: ApiKeyPluginOptions) => ({ kind: "api-key", options })),
  betterAuth: vi.fn(),
  createEmailService: vi.fn(),
  emailSend: vi.fn(),
  databaseInstances: [] as { pragma: ReturnType<typeof vi.fn> }[],
  Database: class MockDatabase {
    pragma = vi.fn();

    constructor(_path: string) {
      mocks.databaseInstances.push(this);
    }
  },
  isAllowedEmail: vi.fn(),
  organization: vi.fn((options: Record<string, unknown>) => ({ kind: "organization", options })),
  magicLink: vi.fn((options: MagicLinkPluginOptions) => ({ kind: "magic-link", options })),
  mkdirSync: vi.fn(),
  jwt: vi.fn(() => ({ kind: "jwt" })),
  oauthProvider: vi.fn((options: OAuthProviderOptions) => ({ kind: "oauth-provider", options })),
  passkey: vi.fn((options: PasskeyPluginOptions) => ({ kind: "passkey", options })),
  runMigrations: vi.fn(),
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

vi.mock("better-auth/plugins/magic-link", () => ({
  magicLink: mocks.magicLink,
}));

vi.mock("better-auth/plugins/jwt", () => ({
  jwt: mocks.jwt,
}));

vi.mock("better-auth/plugins", () => ({
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

vi.mock("@/platform/email/server/service", () => ({
  createEmailService: mocks.createEmailService,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
  isAllowedEmail: mocks.isAllowedEmail,
  validateAuthRuntimeConfig: mocks.validateAuthRuntimeConfig,
}));

describe("auth runtime wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.apiKey.mockClear();
    mocks.betterAuth.mockClear();
    mocks.createEmailService.mockReset();
    mocks.emailSend.mockReset();
    mocks.emailSend.mockResolvedValue(undefined);
    mocks.databaseInstances.length = 0;
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.isAllowedEmail.mockReset();
    mocks.jwt.mockClear();
    mocks.magicLink.mockClear();
    mocks.mkdirSync.mockReset();
    mocks.organization.mockClear();
    mocks.oauthProvider.mockClear();
    mocks.passkey.mockClear();
    mocks.runMigrations.mockReset();
    mocks.sso.mockClear();
    mocks.tanstackStartCookies.mockClear();
    mocks.validateAuthRuntimeConfig.mockReset();
    mocks.getAuthRuntimeConfig.mockReturnValue({
      allowedEmails: new Set(["operator@atlas.test"]),
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

  it("builds Better Auth once with the Atlas database, plugins, and email callbacks", async () => {
    const mod = await import("@/domains/access/server/auth");
    const auth = mod.getAuth();
    const secondAuth = mod.getAuth();

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

    const betterAuthCall = mocks.betterAuth.mock.calls.at(0) as [BetterAuthOptions] | undefined;
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
    expect(typedOptions.plugins.length).toBeGreaterThanOrEqual(6);
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

    await typedOptions.emailVerification.sendVerificationEmail({
      url: "https://atlas.test/account-setup",
      user: { email: "operator@atlas.test" },
    });
    expect(mocks.emailSend).toHaveBeenCalledWith({
      subject: "Verify your Atlas email",
      text: "Verify your email for Atlas: https://atlas.test/account-setup",
      to: "operator@atlas.test",
    });

    mocks.isAllowedEmail.mockReturnValue(true);
    const magicLinkCall = mocks.magicLink.mock.calls.at(0) as [MagicLinkPluginOptions] | undefined;
    const typedMagicLinkOptions = magicLinkCall?.[0];
    expect(typedMagicLinkOptions).toBeDefined();
    if (!typedMagicLinkOptions) {
      throw new TypeError("Expected the Better Auth magic-link plugin to be configured.");
    }
    await typedMagicLinkOptions.sendMagicLink({
      email: "operator@atlas.test",
      url: "https://atlas.test/sign-in",
    });
    expect(mocks.emailSend).toHaveBeenCalledWith({
      subject: "Sign in to Atlas",
      text: "Use this link to sign in to Atlas: https://atlas.test/sign-in",
      to: "operator@atlas.test",
    });

    const oauthProviderCall = mocks.oauthProvider.mock.calls.at(0) as
      | [OAuthProviderOptions]
      | undefined;
    const typedOauthProviderOptions = oauthProviderCall?.[0];
    expect(typedOauthProviderOptions).toBeDefined();
    if (!typedOauthProviderOptions) {
      throw new TypeError("Expected the OAuth provider plugin to be configured.");
    }
    expect(typedOauthProviderOptions.validAudiences).toBeUndefined();

    const ssoCall = mocks.sso.mock.calls.at(0) as [Record<string, unknown>] | undefined;
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

  it("runs Better Auth migrations only once per process", async () => {
    const mod = await import("@/domains/access/server/auth");

    const first = await mod.ensureAuthReady();
    const second = await mod.ensureAuthReady();

    expect(second).toBe(first);
    expect(mocks.runMigrations).toHaveBeenCalledTimes(1);
  });

  it("forwards configured API audiences and maps access-token scope claims", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      allowedEmails: new Set(["operator@atlas.test"]),
      apiAudience: "atlas-api",
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
    mod.getAuth();

    const oauthProviderCall = mocks.oauthProvider.mock.calls.at(0) as
      | [OAuthProviderOptions]
      | undefined;
    const typedOauthProviderOptions = oauthProviderCall?.[0];
    expect(typedOauthProviderOptions).toBeDefined();
    if (!typedOauthProviderOptions?.customAccessTokenClaims) {
      throw new TypeError("Expected OAuth provider access-token claim mapping.");
    }

    expect(typedOauthProviderOptions.validAudiences).toEqual(["atlas-api"]);
    expect(
      typedOauthProviderOptions.customAccessTokenClaims({
        scopes: ["openid", "discovery:write", "entities:write", "admin:all"],
      }),
    ).toEqual({
      permissions: {
        discovery: ["write"],
        entities: ["write"],
      },
    });
  });
});
