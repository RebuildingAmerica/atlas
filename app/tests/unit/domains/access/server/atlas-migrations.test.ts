import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runAtlasCustomMigrations,
  type AtlasMigration,
} from "@/domains/access/server/atlas-migrations";

describe("atlas-migrations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
  });

  afterEach(() => {
    db.close();
  });

  it("creates the tracking table on first run", () => {
    runAtlasCustomMigrations(db, []);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_atlas_migrations'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("runs migrations in order", () => {
    const migrations: AtlasMigration[] = [
      { version: 1, name: "create_foo", sqlite: "CREATE TABLE foo (id TEXT PRIMARY KEY)" },
      { version: 2, name: "create_bar", sqlite: "CREATE TABLE bar (id TEXT PRIMARY KEY)" },
    ];
    runAtlasCustomMigrations(db, migrations);

    const fooExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foo'")
      .get();
    const barExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bar'")
      .get();
    expect(fooExists).toBeTruthy();
    expect(barExists).toBeTruthy();
  });

  it("skips already-run migrations", () => {
    const migrations: AtlasMigration[] = [
      { version: 1, name: "create_foo", sqlite: "CREATE TABLE foo (id TEXT PRIMARY KEY)" },
    ];
    runAtlasCustomMigrations(db, migrations);
    runAtlasCustomMigrations(db, migrations);
  });

  it("records applied migrations", () => {
    const migrations: AtlasMigration[] = [
      { version: 1, name: "create_foo", sqlite: "CREATE TABLE foo (id TEXT PRIMARY KEY)" },
    ];
    runAtlasCustomMigrations(db, migrations);
    const applied = db.prepare("SELECT version, name FROM _atlas_migrations").all() as {
      version: number;
      name: string;
    }[];
    expect(applied).toHaveLength(1);
    expect(applied[0].version).toBe(1);
    expect(applied[0].name).toBe("create_foo");
  });
});
