import { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { getAuthDatabaseConfig } from "../../../../../server/auth-db.workers";
import { runWorkerRequest } from "../../../../../server/request-scope";

const pools = vi.hoisted(() => ({
  created: [] as string[],
  closed: [] as string[],
  released: [] as string[],
}));
vi.mock("pg", () => ({
  Pool: class {
    options: { connectionString: string };
    constructor(options: { connectionString: string }) {
      this.options = options;
      pools.created.push(options.connectionString);
    }
    connect() {
      const owner = this.options.connectionString;
      return Promise.resolve({
        query: () =>
          new Promise((resolve) =>
            setTimeout(() => {
              resolve({ command: "SELECT", rowCount: 1, rows: [{ owner }] });
            }, 1),
          ),
        release: () => pools.released.push(owner),
      });
    }
    end() {
      pools.closed.push(this.options.connectionString);
      return Promise.resolve();
    }
  },
}));

describe("shared auth database configuration", () => {
  it("routes concurrent queries to request-owned pools and closes each pool after its response", async () => {
    const config = getAuthDatabaseConfig();
    expect(getAuthDatabaseConfig()).toBe(config);
    expect(pools.created).toEqual([]);
    const database = new Kysely<{ identity: { owner: string } }>({ dialect: config.dialect });
    await expect(database.selectFrom("identity").selectAll().execute()).rejects.toThrow(
      "requires an active request",
    );
    expect(pools.created).toEqual([]);
    const responses = await Promise.all(
      ["a", "b"].map((name) =>
        runWorkerRequest("postgres://" + name, async () => {
          const first = await database.selectFrom("identity").selectAll().execute();
          const second = await database.selectFrom("identity").selectAll().execute();
          return Response.json({ first, second });
        }),
      ),
    );
    expect(pools.created.sort()).toEqual(["postgres://a", "postgres://b"]);
    expect(pools.closed).toEqual([]);
    const identities = await Promise.all(responses.map((response) => response.json()));
    expect(identities).toEqual([
      { first: [{ owner: "postgres://a" }], second: [{ owner: "postgres://a" }] },
      { first: [{ owner: "postgres://b" }], second: [{ owner: "postgres://b" }] },
    ]);
    expect(pools.released.sort()).toEqual([
      "postgres://a",
      "postgres://a",
      "postgres://b",
      "postgres://b",
    ]);
    expect(pools.closed.sort()).toEqual(["postgres://a", "postgres://b"]);
    await expect(database.selectFrom("identity").selectAll().execute()).rejects.toThrow(
      "requires an active request",
    );
    await database.destroy();
    expect(pools.closed).toHaveLength(2);
  });
});
