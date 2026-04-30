import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => authMocks);

import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import {
  queryActiveProducts,
  queryActiveProductsSqlite,
} from "@/domains/access/server/workspace-products";

describe("workspace-products", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
  });

  afterEach(() => {
    db.close();
  });

  it("returns empty array when no products exist", () => {
    const products = queryActiveProductsSqlite(db, "org_1");
    expect(products).toEqual([]);
  });

  it("returns active products", () => {
    db.prepare(
      "INSERT INTO workspace_products (id, workspace_id, product, status) VALUES (?, ?, ?, ?)",
    ).run("wp_1", "org_1", "atlas_pro", "active");
    const products = queryActiveProductsSqlite(db, "org_1");
    expect(products).toEqual(["atlas_pro"]);
  });

  it("excludes cancelled products", () => {
    db.prepare(
      "INSERT INTO workspace_products (id, workspace_id, product, status) VALUES (?, ?, ?, ?)",
    ).run("wp_1", "org_1", "atlas_pro", "cancelled");
    const products = queryActiveProductsSqlite(db, "org_1");
    expect(products).toEqual([]);
  });

  it("excludes expired passes", () => {
    db.prepare(
      "INSERT INTO workspace_products (id, workspace_id, product, status, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).run("wp_1", "org_1", "atlas_research_pass", "active", "2020-01-01T00:00:00Z");
    const products = queryActiveProductsSqlite(db, "org_1");
    expect(products).toEqual([]);
  });

  it("includes active passes with future expiry", () => {
    db.prepare(
      "INSERT INTO workspace_products (id, workspace_id, product, status, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).run("wp_1", "org_1", "atlas_research_pass", "active", "2099-01-01T00:00:00Z");
    const products = queryActiveProductsSqlite(db, "org_1");
    expect(products).toEqual(["atlas_research_pass"]);
  });

  it("includes subscriptions with null expires_at", () => {
    db.prepare(
      "INSERT INTO workspace_products (id, workspace_id, product, status) VALUES (?, ?, ?, ?)",
    ).run("wp_1", "org_1", "atlas_team", "active");
    const products = queryActiveProductsSqlite(db, "org_1");
    expect(products).toEqual(["atlas_team"]);
  });

  it("scopes results to the given workspace", () => {
    db.prepare(
      "INSERT INTO workspace_products (id, workspace_id, product, status) VALUES (?, ?, ?, ?)",
    ).run("wp_1", "org_1", "atlas_pro", "active");
    db.prepare(
      "INSERT INTO workspace_products (id, workspace_id, product, status) VALUES (?, ?, ?, ?)",
    ).run("wp_2", "org_2", "atlas_team", "active");
    expect(queryActiveProductsSqlite(db, "org_1")).toEqual(["atlas_pro"]);
    expect(queryActiveProductsSqlite(db, "org_2")).toEqual(["atlas_team"]);
  });
});

describe("queryActiveProducts", () => {
  beforeEach(() => {
    authMocks.getAuthDatabase.mockReset();
    authMocks.getAuthPgPool.mockReset();
  });

  it("uses the Postgres pool when one is configured", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ product: "atlas_team" }, { product: "atlas_pro" }],
    });
    authMocks.getAuthPgPool.mockReturnValue({ query });

    const products = await queryActiveProducts("org_1");

    expect(products).toEqual(["atlas_team", "atlas_pro"]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(["org_1"]);
  });

  it("falls back to SQLite when no Postgres pool is configured", async () => {
    authMocks.getAuthPgPool.mockReturnValue(null);
    const sqliteDb = new Database(":memory:");
    runAtlasCustomMigrations(sqliteDb, ATLAS_MIGRATIONS);
    sqliteDb
      .prepare(
        "INSERT INTO workspace_products (id, workspace_id, product, status) VALUES (?, ?, ?, ?)",
      )
      .run("wp_1", "org_1", "atlas_pro", "active");
    authMocks.getAuthDatabase.mockReturnValue(sqliteDb);

    const products = await queryActiveProducts("org_1");

    expect(products).toEqual(["atlas_pro"]);
    sqliteDb.close();
  });

  it("returns an empty array when neither database is available", async () => {
    authMocks.getAuthPgPool.mockReturnValue(null);
    authMocks.getAuthDatabase.mockReturnValue(null);

    expect(await queryActiveProducts("org_1")).toEqual([]);
  });
});
