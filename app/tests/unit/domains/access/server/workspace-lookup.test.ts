import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => authMocks);

import { resolvePrimaryWorkspaceId } from "@/domains/access/server/workspace-lookup";

describe("resolvePrimaryWorkspaceId", () => {
  let db: Database.Database;

  beforeEach(() => {
    authMocks.getAuthDatabase.mockReset();
    authMocks.getAuthPgPool.mockReset();
    db = new Database(":memory:");
    db.exec(
      'CREATE TABLE member ("organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL); ' +
        "CREATE TABLE member_alias_for_test (id INTEGER);",
    );
    db.exec(
      "DROP TABLE member_alias_for_test; " +
        "CREATE TABLE IF NOT EXISTS member_compat (organizationId TEXT, userId TEXT);",
    );
    // The SQLite query in resolvePrimaryWorkspaceId expects unquoted column
    // names, so build a parallel `member` shape that matches both queries.
    db.exec("DROP TABLE member; CREATE TABLE member (organizationId TEXT, userId TEXT)");
  });

  afterEach(() => {
    db.close();
  });

  it("returns null when userId is empty", async () => {
    expect(await resolvePrimaryWorkspaceId("")).toBeNull();
    expect(authMocks.getAuthPgPool).not.toHaveBeenCalled();
    expect(authMocks.getAuthDatabase).not.toHaveBeenCalled();
  });

  it("returns the single workspace from the Postgres pool when available", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ organizationId: "org_solo" }],
    });
    authMocks.getAuthPgPool.mockReturnValue({ query });

    expect(await resolvePrimaryWorkspaceId("user_1")).toBe("org_solo");
    expect(query.mock.calls[0]?.[1]).toEqual(["user_1"]);
  });

  it("returns null from the Postgres pool when the user has zero or multiple workspaces", async () => {
    authMocks.getAuthPgPool.mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    });
    expect(await resolvePrimaryWorkspaceId("user_1")).toBeNull();

    authMocks.getAuthPgPool.mockReturnValue({
      query: vi.fn().mockResolvedValue({
        rows: [{ organizationId: "org_a" }, { organizationId: "org_b" }],
      }),
    });
    expect(await resolvePrimaryWorkspaceId("user_2")).toBeNull();
  });

  it("returns null when no Postgres pool and no SQLite database is configured", async () => {
    authMocks.getAuthPgPool.mockReturnValue(null);
    authMocks.getAuthDatabase.mockReturnValue(null);
    expect(await resolvePrimaryWorkspaceId("user_1")).toBeNull();
  });

  it("returns the single workspace from SQLite when no Postgres pool is configured", async () => {
    authMocks.getAuthPgPool.mockReturnValue(null);
    authMocks.getAuthDatabase.mockReturnValue(db);
    db.prepare("INSERT INTO member (organizationId, userId) VALUES (?, ?)").run(
      "org_solo",
      "user_1",
    );
    expect(await resolvePrimaryWorkspaceId("user_1")).toBe("org_solo");
  });

  it("returns null from SQLite when the user has zero or multiple workspaces", async () => {
    authMocks.getAuthPgPool.mockReturnValue(null);
    authMocks.getAuthDatabase.mockReturnValue(db);
    expect(await resolvePrimaryWorkspaceId("user_orphan")).toBeNull();

    db.prepare("INSERT INTO member (organizationId, userId) VALUES (?, ?)").run(
      "org_a",
      "user_dual",
    );
    db.prepare("INSERT INTO member (organizationId, userId) VALUES (?, ?)").run(
      "org_b",
      "user_dual",
    );
    expect(await resolvePrimaryWorkspaceId("user_dual")).toBeNull();
  });
});
