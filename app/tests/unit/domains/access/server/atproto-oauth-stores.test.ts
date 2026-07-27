import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn(),
  getAuthPgPool: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));

describe("atproto-oauth-stores", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getAuthDatabase.mockReset();
    mocks.getAuthPgPool.mockReset();
    mocks.getAuthPgPool.mockReturnValue(null);
  });

  it("prunes every ATProto OAuth store on demand", async () => {
    const run = vi.fn();
    const prepare = vi.fn().mockReturnValue({ run });
    mocks.getAuthDatabase.mockReturnValue({ prepare });
    const { pruneAtprotoOAuthStores } =
      await import("@/domains/access/server/atproto-oauth-stores");

    await pruneAtprotoOAuthStores();

    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_state WHERE updated_at < ?");
    expect(prepare).toHaveBeenCalledWith("DELETE FROM atproto_oauth_session WHERE updated_at < ?");
    expect(prepare).toHaveBeenCalledWith(
      "DELETE FROM atproto_oauth_app_state WHERE updated_at < ?",
    );
  });

  it("stores and reads OAuth app state as JSON", async () => {
    const storedRows = new Map<string, string>();
    const run = vi.fn((key: string, value?: string) => {
      if (typeof value === "string") {
        storedRows.set(key, value);
        return;
      }
      storedRows.delete(key);
    });
    const get = vi.fn((key: string) => {
      const value = storedRows.get(key);
      return value ? { value } : undefined;
    });
    const prepare = vi.fn((sql: string) => {
      if (sql.startsWith("SELECT")) return { get };
      return { run };
    });
    mocks.getAuthDatabase.mockReturnValue({ prepare });
    const { createAtprotoOAuthStores } =
      await import("@/domains/access/server/atproto-oauth-stores");

    const { appStateStore } = createAtprotoOAuthStores();
    await appStateStore.set("state_1", {
      requestedHandle: "org.example",
      returnTo: "/claim/org",
      userId: "user_1",
    });

    await expect(appStateStore.get("state_1")).resolves.toEqual({
      requestedHandle: "org.example",
      returnTo: "/claim/org",
      userId: "user_1",
    });
    expect(prepare).toHaveBeenCalledWith(
      "DELETE FROM atproto_oauth_app_state WHERE updated_at < ?",
    );
    expect(run).toHaveBeenCalledWith("state_1", expect.stringContaining("org.example"));
  });

  it("round-trips a pending sign-in through SQLite and forgets it on delete", async () => {
    const database = new Database(":memory:");
    mocks.getAuthDatabase.mockReturnValue(database);
    const { createAtprotoOAuthStores } =
      await import("@/domains/access/server/atproto-oauth-stores");

    const { appStateStore } = createAtprotoOAuthStores();
    await expect(appStateStore.get("state_1")).resolves.toBeUndefined();

    await appStateStore.set("state_1", {
      flow: "sign-in",
      requestedHandle: "ada.example",
      returnTo: "/account",
    });
    await expect(appStateStore.get("state_1")).resolves.toEqual({
      flow: "sign-in",
      requestedHandle: "ada.example",
      returnTo: "/account",
    });

    await appStateStore.set("state_1", {
      flow: "link",
      requestedHandle: "ada.example",
      returnTo: "/claim",
    });
    await expect(appStateStore.get("state_1")).resolves.toMatchObject({ flow: "link" });

    await appStateStore.del("state_1");
    await expect(appStateStore.get("state_1")).resolves.toBeUndefined();

    database.close();
  });

  it("forgets an OAuth handshake that has aged past its TTL", async () => {
    const database = new Database(":memory:");
    mocks.getAuthDatabase.mockReturnValue(database);
    const { createAtprotoOAuthStores } =
      await import("@/domains/access/server/atproto-oauth-stores");

    const { appStateStore } = createAtprotoOAuthStores();
    await appStateStore.set("state_1", { requestedHandle: "ada.example", returnTo: "/account" });
    database
      .prepare("UPDATE atproto_oauth_app_state SET updated_at = ? WHERE key = ?")
      .run(new Date(Date.now() - 60 * 60 * 1000).toISOString(), "state_1");

    await expect(appStateStore.get("state_1")).resolves.toBeUndefined();

    database.close();
  });

  it("refuses to serve an OAuth handshake when no auth database is configured", async () => {
    mocks.getAuthDatabase.mockReturnValue(null);
    const { createAtprotoOAuthStores } =
      await import("@/domains/access/server/atproto-oauth-stores");

    const { stateStore } = createAtprotoOAuthStores();
    await expect(stateStore.get("state_1")).rejects.toThrow("Auth database unavailable.");
  });

  it("keeps every store operation on the pool when Postgres backs auth", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ value: { dpopKey: "k" } }] });
    mocks.getAuthPgPool.mockReturnValue({ query });
    const { createAtprotoOAuthStores } =
      await import("@/domains/access/server/atproto-oauth-stores");

    const { sessionStore } = createAtprotoOAuthStores();
    await expect(sessionStore.get("did:plc:abc")).resolves.toEqual({ dpopKey: "k" });

    const statements = query.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toMatch(/CREATE TABLE IF NOT EXISTS atproto_oauth_session/);
    expect(statements[1]).toMatch(
      /DELETE FROM atproto_oauth_session WHERE updated_at < now\(\) - \$1::interval/,
    );
    expect(query.mock.calls[1]?.[1]).toEqual(["86400 seconds"]);
    expect(statements[2]).toBe("SELECT value FROM atproto_oauth_session WHERE key = $1");
    expect(mocks.getAuthDatabase).not.toHaveBeenCalled();
  });

  it("writes and clears Postgres-backed rows without touching SQLite", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    mocks.getAuthPgPool.mockReturnValue({ query });
    const { createAtprotoOAuthStores, pruneAtprotoOAuthStores } =
      await import("@/domains/access/server/atproto-oauth-stores");

    const stores = createAtprotoOAuthStores();
    await stores.stateStore.set("state_1", { dpopKey: "k" } as never);
    await stores.stateStore.del("state_1");
    await pruneAtprotoOAuthStores(stores);

    const inserts = query.mock.calls.filter((call) => String(call[0]).startsWith("INSERT INTO"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]).toEqual(["state_1", { dpopKey: "k" }]);
    expect(
      query.mock.calls.filter((call) =>
        String(call[0]).startsWith("DELETE FROM atproto_oauth_state WHERE key"),
      ),
    ).toEqual([["DELETE FROM atproto_oauth_state WHERE key = $1", ["state_1"]]]);
    expect(mocks.getAuthDatabase).not.toHaveBeenCalled();
  });
});
