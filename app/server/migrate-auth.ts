import { getAuth, runAtlasAuthMigrations, getAuthPgPool } from "../src/domains/access/server/auth";
import { AUTH_SCHEMA_VERSION } from "./auth-schema";

const pool = getAuthPgPool();
if (!pool) throw new Error("Hosted release migrations require PostgreSQL.");
const lock = await pool.connect();
try {
  await lock.query("SELECT pg_advisory_lock(hashtext('atlas.auth.release'))");
  const auth = await getAuth();
  await runAtlasAuthMigrations(await auth.$context);
  for (const table of ["atproto_oauth_app_state", "atproto_oauth_session", "atproto_oauth_state"]) {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
  }
  await pool.query(
    "CREATE TABLE IF NOT EXISTS atlas_runtime_schema (name TEXT PRIMARY KEY, version TEXT NOT NULL)",
  );
  await pool.query(
    "INSERT INTO atlas_runtime_schema (name,version) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET version = EXCLUDED.version",
    ["web", AUTH_SCHEMA_VERSION],
  );
  process.stdout.write(
    JSON.stringify({ event: "atlas_auth_schema_ready", version: AUTH_SCHEMA_VERSION }) + "\n",
  );
} finally {
  await lock.query("SELECT pg_advisory_unlock(hashtext('atlas.auth.release'))");
  lock.release();
  await pool.end();
}
