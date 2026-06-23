import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrganizationPendingInvitationPluginConfig as OrganizationPluginConfig } from "@/../tests/helpers/access/sso-provider-mocks";

const mocks = vi.hoisted(() => ({
  apiKey: vi.fn(() => ({ kind: "api-key" })),
  betterAuth: vi.fn(),
  createEmailService: vi.fn(),
  emailSend: vi.fn(),
  getActiveMemberRole: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  isAllowedEmail: vi.fn(),
  jwt: vi.fn(() => ({ kind: "jwt" })),
  listOrganizations: vi.fn(),
  listUserInvitations: vi.fn(),
  magicLink: vi.fn(() => ({ kind: "magic-link" })),
  mkdirSync: vi.fn(),
  oauthProvider: vi.fn(() => ({ kind: "oauth-provider" })),
  organization: vi.fn((options: OrganizationPluginConfig) => ({ kind: "organization", options })),
  passkey: vi.fn(() => ({ kind: "passkey" })),
  pgPoolQuery: vi.fn(),
  render: vi.fn().mockResolvedValue("<html></html>"),
  runMigrations: vi.fn(),
  sso: vi.fn(() => ({ kind: "sso" })),
  sqliteGet: vi.fn(),
  sqlitePrepare: vi.fn(),
  sqlitePragma: vi.fn(),
  sqliteRun: vi.fn(),
  tanstackStartCookies: vi.fn(() => ({ kind: "cookies" })),
  validateAuthRuntimeConfig: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: mocks.mkdirSync,
  },
  mkdirSync: mocks.mkdirSync,
}));

vi.mock("better-sqlite3", () => ({
  default: class {
    prepare = mocks.sqlitePrepare;
    pragma = mocks.sqlitePragma;
  },
}));

vi.mock("pg", () => ({
  Pool: class {
    query = mocks.pgPoolQuery;
  },
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

vi.mock("@react-email/render", () => ({
  render: mocks.render,
}));

vi.mock("@/platform/email/server/service", () => ({
  createEmailService: mocks.createEmailService,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
  isAllowedEmail: mocks.isAllowedEmail,
  validateAuthRuntimeConfig: mocks.validateAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/atlas-migrations", () => ({
  ATLAS_MIGRATIONS: [],
  runAtlasCustomMigrations: vi.fn(),
  runAtlasCustomMigrationsPg: vi.fn(),
}));

describe("auth — invitation success path and organization invitation email", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.emailSend.mockResolvedValue(undefined);
    mocks.runMigrations.mockResolvedValue(undefined);
    mocks.sqlitePrepare.mockReturnValue({
      get: mocks.sqliteGet,
      run: mocks.sqliteRun,
    });
    mocks.getAuthRuntimeConfig.mockReturnValue({
      allowedEmails: new Set(),
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api-key",
      apiAudience: null,
      apiBaseUrl: null,
      databaseUrl: null,
      localMode: false,
      openRegistration: false,
      captureUrl: "http://127.0.0.1:8025/messages",
      cimdAllowedHostSuffixes: [],
      dbPath: "/tmp/atlas/auth.sqlite",
      emailFrom: "Atlas <auth@atlas.test>",
      emailProvider: "capture",
      internalSecret: "internal-test-secret",
      passkeyRpId: null,
      publicBaseUrl: "https://atlas.test",
      publicDomain: "atlas.test",
      resendApiKey: null,
      samlAllowedIssuerOrigins: new Set(),
      samlSpPrivateKey: null,
      samlSpPrivateKeyPass: null,
    });
    mocks.validateAuthRuntimeConfig.mockReturnValue(undefined);
    mocks.createEmailService.mockReturnValue({
      send: mocks.emailSend,
    });
    mocks.isAllowedEmail.mockReturnValue(false);
    mocks.betterAuth.mockImplementation(() => ({
      $context: Promise.resolve({
        runMigrations: mocks.runMigrations,
      }),
      api: {
        listUserInvitations: mocks.listUserInvitations,
        getActiveMemberRole: mocks.getActiveMemberRole,
        listOrganizations: mocks.listOrganizations,
      },
    }));
  });

  it("returns true when ensureAuthReady reveals a pending invitation", async () => {
    mocks.listUserInvitations.mockResolvedValue([{ status: "pending" }]);
    mocks.sqliteGet.mockReturnValue({ membershipCount: 0 });

    const { canEmailAccessAtlas } = await import("@/domains/access/server/auth");
    expect(await canEmailAccessAtlas("invited@atlas.test")).toBe(true);
    expect(mocks.listUserInvitations).toHaveBeenCalled();
  });

  it("returns false when ensureAuthReady returns only non-pending invitations", async () => {
    mocks.listUserInvitations.mockResolvedValue([{ status: "accepted" }, { status: "rejected" }]);
    mocks.sqliteGet.mockReturnValue({ membershipCount: 0 });

    const { canEmailAccessAtlas } = await import("@/domains/access/server/auth");
    expect(await canEmailAccessAtlas("invited@atlas.test")).toBe(false);
  });

  it("delivers the organization invitation email via the magic-link plugin sender", async () => {
    const mod = await import("@/domains/access/server/auth");
    mod.getAuth();

    const organizationCall = mocks.organization.mock.calls[0]?.[0];

    if (!organizationCall) {
      throw new Error("Expected the organization plugin to be configured.");
    }

    await organizationCall.sendInvitationEmail({
      email: "newmember@atlas.test",
      id: "inv_123",
      organization: { name: "Atlas Team" },
    });

    expect(mocks.emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Join Atlas Team on Atlas",
        to: "newmember@atlas.test",
      }),
    );
    const sentMessage = mocks.emailSend.mock.calls[0]?.[0] as { text: string };
    expect(sentMessage.text).toContain("https://atlas.test/accept-invitation/inv_123");
  });

  it("enforces requirePKCE = true on every existing oauthClient row in SQLite", async () => {
    const mod = await import("@/domains/access/server/auth");
    await mod.ensureAuthReady();

    expect(mocks.sqlitePrepare).toHaveBeenCalledWith(
      expect.stringContaining("update oauthClient set requirePKCE = 1"),
    );
    expect(mocks.sqliteRun).toHaveBeenCalled();
  });

  it("uses the Postgres pool for membership lookup when DATABASE_URL is set", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      allowedEmails: new Set(),
      apiAudience: null,
      apiBaseUrl: null,
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api-key",
      databaseUrl: "postgres://atlas",
      localMode: false,
      openRegistration: false,
      captureUrl: "http://127.0.0.1:8025/messages",
      cimdAllowedHostSuffixes: [],
      dbPath: "/tmp/atlas/auth.sqlite",
      emailFrom: "Atlas <auth@atlas.test>",
      emailProvider: "capture",
      internalSecret: "internal-test-secret",
      passkeyRpId: null,
      publicBaseUrl: "https://atlas.test",
      publicDomain: "atlas.test",
      resendApiKey: null,
      samlAllowedIssuerOrigins: new Set(),
      samlSpPrivateKey: null,
      samlSpPrivateKeyPass: null,
    });
    mocks.pgPoolQuery.mockResolvedValueOnce({
      rows: [{ membershipCount: 1 }],
    });

    const { canEmailAccessAtlas } = await import("@/domains/access/server/auth");
    await expect(canEmailAccessAtlas("member@atlas.test")).resolves.toBe(true);
    expect(mocks.pgPoolQuery).toHaveBeenCalledWith(expect.stringContaining("count(member.id)"), [
      "member@atlas.test",
    ]);
  });

  it("forces requirePKCE = true on every existing oauthClient row in Postgres", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      allowedEmails: new Set(),
      apiAudience: null,
      apiBaseUrl: null,
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api-key",
      databaseUrl: "postgres://atlas",
      localMode: false,
      openRegistration: false,
      captureUrl: "http://127.0.0.1:8025/messages",
      cimdAllowedHostSuffixes: [],
      dbPath: "/tmp/atlas/auth.sqlite",
      emailFrom: "Atlas <auth@atlas.test>",
      emailProvider: "capture",
      internalSecret: "internal-test-secret",
      passkeyRpId: null,
      publicBaseUrl: "https://atlas.test",
      publicDomain: "atlas.test",
      resendApiKey: null,
      samlAllowedIssuerOrigins: new Set(),
      samlSpPrivateKey: null,
      samlSpPrivateKeyPass: null,
    });
    mocks.pgPoolQuery.mockResolvedValue({ rows: [] });

    const mod = await import("@/domains/access/server/auth");
    await mod.ensureAuthReady();

    expect(mocks.pgPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('update "oauthClient" set "requirePKCE"'),
    );
  });

  it("returns the Postgres-backed account existence count", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      allowedEmails: new Set(),
      apiAudience: null,
      apiBaseUrl: null,
      apiKeyIntrospectionUrl: "http://127.0.0.1:3100/api-key",
      databaseUrl: "postgres://atlas",
      localMode: false,
      openRegistration: false,
      captureUrl: "http://127.0.0.1:8025/messages",
      cimdAllowedHostSuffixes: [],
      dbPath: "/tmp/atlas/auth.sqlite",
      emailFrom: "Atlas <auth@atlas.test>",
      emailProvider: "capture",
      internalSecret: "internal-test-secret",
      passkeyRpId: null,
      publicBaseUrl: "https://atlas.test",
      publicDomain: "atlas.test",
      resendApiKey: null,
      samlAllowedIssuerOrigins: new Set(),
      samlSpPrivateKey: null,
      samlSpPrivateKeyPass: null,
    });
    mocks.pgPoolQuery.mockResolvedValueOnce({ rows: [{ userCount: 1 }] });

    const { hasExistingAccount } = await import("@/domains/access/server/auth");
    await expect(hasExistingAccount("operator@atlas.test")).resolves.toBe(true);
  });
});
