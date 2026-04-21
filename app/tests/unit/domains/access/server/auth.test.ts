import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pgPoolQuery: vi.fn(),
  sqliteGet: vi.fn(),
  sqlitePrepare: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  isAllowedEmail: vi.fn(),
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
  isAllowedEmail: mocks.isAllowedEmail,
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
    ensureAuthReady: vi.fn(),
  };
});

import {
  canEmailAccessAtlas,
  createMagicLinkSender,
  createVerificationEmailSender,
  ensureAuthReady,
} from "@/domains/access/server/auth";

describe("canEmailAccessAtlas", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.pgPoolQuery.mockReset();
    mocks.sqliteGet.mockReset();
    mocks.sqlitePrepare.mockReset();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.isAllowedEmail.mockReset();
    vi.mocked(ensureAuthReady).mockReset();

    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: false });
    mocks.isAllowedEmail.mockReturnValue(false);

    mocks.sqlitePrepare.mockReturnValue({ get: mocks.sqliteGet });
  });

  it("grants access to allowed bootstrap emails", async () => {
    mocks.isAllowedEmail.mockReturnValue(true);
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

    vi.mocked(ensureAuthReady).mockResolvedValue({
      api: {
        listUserInvitations: vi.fn().mockResolvedValue([]),
      },
    } as unknown as Awaited<ReturnType<typeof ensureAuthReady>>);

    expect(await canEmailAccessAtlas("nobody@atlas.test")).toBe(false);
  });

  it("denies access when the invitation check throws", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: false, databaseUrl: "postgres://..." });
    mocks.pgPoolQuery.mockResolvedValue({ rows: [{ membershipCount: 0 }] });

    vi.mocked(ensureAuthReady).mockRejectedValue(new Error("API down"));

    expect(await canEmailAccessAtlas("invited@atlas.test")).toBe(false);
  });
});

describe("createMagicLinkSender", () => {
  it("delivers magic links for allowed emails", async () => {
    const deliverMagicLink = vi.fn().mockResolvedValue(undefined);
    mocks.isAllowedEmail.mockReturnValue(true);

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
    mocks.isAllowedEmail.mockReturnValue(false);
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
      url: "https://atlas.test/account-setup",
    });

    expect(deliverVerificationEmail).toHaveBeenCalledWith(
      "operator@atlas.test",
      "https://atlas.test/account-setup",
    );
  });
});
