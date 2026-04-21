import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import { queryActiveProductsSqlite } from "@/domains/access/server/workspace-products";

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
