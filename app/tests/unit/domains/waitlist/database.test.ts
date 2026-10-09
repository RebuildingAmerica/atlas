import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  getWaitlistDatabase,
  postgresWaitlistDatabase,
  sqliteWaitlistDatabase,
} from "@/domains/waitlist/server/database";
import { WaitlistStore } from "@/domains/waitlist/server/store";
import { WAITLIST_SCHEMA } from "@/domains/waitlist/server/schema";
const mocks = vi.hoisted(() => ({ pool: vi.fn(), sqlite: vi.fn() }));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth-db", () => ({
  getAuthPgPool: mocks.pool,
  getAuthDatabase: mocks.sqlite,
}));
describe("waitlist database portability", () => {
  it("commits PostgreSQL writes with translated parameters and releases a failed transaction", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "result" }] });
    const release = vi.fn();
    const pool = { connect: () => Promise.resolve({ query, release }) } as unknown as Pool;
    mocks.pool.mockReturnValue(pool);
    const adapter = getWaitlistDatabase();
    expect(
      await adapter.transaction((db) => db.query("SELECT ? AS id, ? AS email", ["id", "email"])),
    ).toEqual([{ id: "result" }]);
    expect(query).toHaveBeenCalledWith("SELECT $1 AS id, $2 AS email", ["id", "email"]);
    expect(query).toHaveBeenCalledWith("COMMIT");
    await expect(adapter.transaction(() => Promise.reject(new Error("failure")))).rejects.toThrow(
      "failure",
    );
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(2);
  });
  it("uses the configured SQLite adapter and fails explicitly without an auth database", async () => {
    mocks.pool.mockReturnValue(null);
    const sqlite = new Database(":memory:");
    mocks.sqlite.mockReturnValue(sqlite);
    expect(await getWaitlistDatabase().transaction((db) => db.query("SELECT 1 AS value"))).toEqual([
      { value: 1 },
    ]);
    const adapter = sqliteWaitlistDatabase(sqlite);
    await expect(
      adapter.transaction(() => Promise.reject(new Error("rollback"))),
    ).rejects.toThrow();
    expect(await adapter.transaction((db) => db.query("SELECT 2 AS value"))).toEqual([
      { value: 2 },
    ]);
    sqlite.close();
    mocks.sqlite.mockReturnValue(null);
    expect(getWaitlistDatabase).toThrow("unavailable");
  });
  it.skipIf(!process.env.ATLAS_WAITLIST_TEST_POSTGRES_URL)(
    "persists concurrent invitations in a real PostgreSQL database",
    async () => {
      const schema = `waitlist_test_${randomUUID().replaceAll("-", "")}`;
      const pool = new Pool({
        connectionString: process.env.ATLAS_WAITLIST_TEST_POSTGRES_URL,
        options: `-c search_path=${schema}`,
      });
      try {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(WAITLIST_SCHEMA);
        const store = new WaitlistStore(postgresWaitlistDatabase(pool));
        const request = await store.submit({ email: "pg@example.org", product: "atlas_pro" });
        await store.confirm(await store.createLink(request.id, "confirm"));
        await Promise.all([
          store.invite(request.id, "staff-a"),
          store.invite(request.id, "staff-b"),
        ]);
        expect(await store.isAdmitted(request.email, "atlas_pro")).toBe(true);
        expect(
          (await store.events(request.id)).filter((event) => event.action === "invited"),
        ).toHaveLength(1);
        await store.rateLimit("ip", 1, 60_000);
        await expect(store.rateLimit("ip", 1, 60_000)).rejects.toThrow("Too many");
        await store.revoke(request.id, "staff-a");
        expect(await store.isAdmitted(request.email, "atlas_pro")).toBe(false);
      } finally {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
      }
    },
  );
});
