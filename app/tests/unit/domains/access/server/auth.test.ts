import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pgPoolQuery: vi.fn(),
  sqliteGet: vi.fn(),
  sqlitePrepare: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  isOperatorAllowedEmail: vi.fn(),
  listUserInvitations: vi.fn(),
  emailSend: vi.fn(),
  createEmailService: vi.fn(),
  render: vi.fn().mockResolvedValue("<html></html>"),
}));

vi.mock("pg", () => ({
  Pool: class {
    query = mocks.pgPoolQuery;
  },
}));

vi.mock("better-sqlite3", () => {
  return {
    default: class {
      prepare = mocks.sqlitePrepare;
      pragma = vi.fn();
    },
  };
});

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
  isOperatorAllowedEmail: mocks.isOperatorAllowedEmail,
  validateAuthRuntimeConfig: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: vi.fn(),
  },
}));

vi.mock("@/domains/access/server/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ensureAuthReady: vi.fn().mockResolvedValue({
      api: {
        listUserInvitations: mocks.listUserInvitations,
      },
    }),
  };
});

vi.mock("@react-email/render", () => ({
  render: mocks.render,
}));

vi.mock("@/platform/email/server/service", () => ({
  createEmailService: mocks.createEmailService,
}));

import {
  canEmailAccessAtlas,
  createMagicLinkSender,
  createVerificationEmailSender,
  ensureAuthReady,
  hasExistingAccount,
} from "@/domains/access/server/auth";

describe("canEmailAccessAtlas", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.pgPoolQuery.mockReset();
    mocks.sqliteGet.mockReset();
    mocks.sqlitePrepare.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.isOperatorAllowedEmail.mockReset();
    mocks.listUserInvitations.mockReset();
    vi.mocked(ensureAuthReady).mockClear();

    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: false });
    mocks.isOperatorAllowedEmail.mockReturnValue(false);

    mocks.sqlitePrepare.mockReturnValue({ get: mocks.sqliteGet });
  });

  it("grants access to allowed bootstrap emails", async () => {
    mocks.isOperatorAllowedEmail.mockReturnValue(true);
    expect(await canEmailAccessAtlas("allowed@atlas.test")).toBe(true);
  });

  it("denies access in local mode for non-bootstrap emails", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: true });
    expect(await canEmailAccessAtlas("outside@atlas.test")).toBe(false);
  });

  it("grants access when an existing membership exists (PostgreSQL)", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: false, databaseUrl: "postgres://..." });
    mocks.pgPoolQuery.mockResolvedValue({ rows: [{ membershipCount: 1 }] });

    expect(await canEmailAccessAtlas("member@atlas.test")).toBe(true);
  });

  it("grants access when an existing membership exists (SQLite)", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
      databaseUrl: undefined,
      dbPath: "test.db",
    });
    mocks.sqliteGet.mockReturnValue({ membershipCount: 1 });

    expect(await canEmailAccessAtlas("member@atlas.test")).toBe(true);
  });

  it("denies access when no bootstrap, membership, or invitation exists", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: false, databaseUrl: "postgres://..." });
    mocks.pgPoolQuery.mockResolvedValue({ rows: [{ membershipCount: 0 }] });

    mocks.listUserInvitations.mockResolvedValue([]);

    expect(await canEmailAccessAtlas("nobody@atlas.test")).toBe(false);
  });

  it("denies access when the invitation check throws", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: false, databaseUrl: "postgres://..." });
    mocks.pgPoolQuery.mockResolvedValue({ rows: [{ membershipCount: 0 }] });

    mocks.listUserInvitations.mockRejectedValue(new Error("API down"));

    expect(await canEmailAccessAtlas("invited@atlas.test")).toBe(false);
  });

  it("grants access immediately when open registration is enabled", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
      databaseUrl: "postgres://...",
      openRegistration: true,
    });

    expect(await canEmailAccessAtlas("anyone@atlas.test")).toBe(true);
    expect(mocks.pgPoolQuery).not.toHaveBeenCalled();
  });
});

describe("hasExistingAccount", () => {
  beforeEach(() => {
    mocks.pgPoolQuery.mockReset();
    mocks.sqliteGet.mockReset();
    mocks.sqlitePrepare.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.sqlitePrepare.mockReturnValue({ get: mocks.sqliteGet });
  });

  it("returns true when an account row exists in Postgres", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
      databaseUrl: "postgres://...",
    });
    mocks.pgPoolQuery.mockResolvedValue({ rows: [{ userCount: 1 }] });

    expect(await hasExistingAccount("OPERATOR@atlas.test")).toBe(true);
    expect(mocks.pgPoolQuery).toHaveBeenCalledWith(expect.any(String), ["operator@atlas.test"]);
  });

  it("returns false when Postgres reports a count of zero", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
      databaseUrl: "postgres://...",
    });
    mocks.pgPoolQuery.mockResolvedValue({ rows: [{ userCount: 0 }] });

    expect(await hasExistingAccount("missing@atlas.test")).toBe(false);
  });

  it("returns true when an account row exists in SQLite", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
      databaseUrl: undefined,
      dbPath: "test.db",
    });
    mocks.sqliteGet.mockReturnValue({ userCount: 1 });

    expect(await hasExistingAccount("operator@atlas.test")).toBe(true);
  });

  it("returns false when SQLite reports a count of zero", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
      databaseUrl: undefined,
      dbPath: "test.db",
    });
    mocks.sqliteGet.mockReturnValue({ userCount: 0 });

    expect(await hasExistingAccount("missing@atlas.test")).toBe(false);
  });
});

describe("createMagicLinkSender", () => {
  it("delivers magic links for allowed emails", async () => {
    const deliverMagicLink = vi.fn().mockResolvedValue(undefined);
    mocks.isOperatorAllowedEmail.mockReturnValue(true);

    await createMagicLinkSender(deliverMagicLink)({
      email: "allowed@atlas.test",
      url: "https://atlas.test/sign-in",
    });

    expect(deliverMagicLink).toHaveBeenCalledWith(
      "allowed@atlas.test",
      "https://atlas.test/sign-in",
    );
  });

  it("silently ignores unapproved emails", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: true });
    mocks.isOperatorAllowedEmail.mockReturnValue(false);
    const deliverMagicLink = vi.fn().mockResolvedValue(undefined);

    await createMagicLinkSender(deliverMagicLink)({
      email: "outside@atlas.test",
      url: "https://atlas.test/sign-in",
    });

    expect(deliverMagicLink).not.toHaveBeenCalled();
  });
});

describe("createVerificationEmailSender", () => {
  it("delivers verification emails through the provided sender", async () => {
    const deliverVerificationEmail = vi.fn().mockResolvedValue(undefined);

    await createVerificationEmailSender(deliverVerificationEmail)({
      email: "operator@atlas.test",
      url: "https://atlas.test/setup",
    });

    expect(deliverVerificationEmail).toHaveBeenCalledWith(
      "operator@atlas.test",
      "https://atlas.test/setup",
    );
  });
});
