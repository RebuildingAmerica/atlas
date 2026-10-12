import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import type * as AuthModule from "@/domains/access/server/auth";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null, ensureAuthReady: vi.fn() }));
vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: state.ensureAuthReady,
  getAuthPgPool: () => state.pool,
}));
import {
  buildHostedE2EAccountSeeds,
  cleanupHostedE2ERun,
  handleHostedE2EIdentityRequest,
} from "@/domains/access/server/hosted-e2e";

// The same explicit PostgreSQL lane as API tests. CI starts its disposable
// service for app-only runs too; no production database is used.
describe.skipIf(!process.env.ATLAS_TEST_POSTGRES_URL)(
  "hosted fixture cleanup with PostgreSQL",
  () => {
    const runId = "38246581597-1";
    const ownerId = "hosted_e2e_user_owner";
    const delegateId = "hosted_e2e_user_delegate";
    const outsiderId = "real_user";
    const pds = "https://pds.example.org";

    let admin: Pool;
    let authPool: Pool | null = null;
    let authInstance: Awaited<ReturnType<typeof AuthModule.getAuth>>;
    const database = `atlas_cleanup_${randomUUID().replaceAll("-", "")}`;
    function env() {
      vi.stubEnv("ATLAS_PDS_PUBLIC_URL", pds);
      vi.stubEnv("ATLAS_PDS_INVITE_BROKER_URL", `${pds}/_atlas/pds/invites`);
      vi.stubEnv("ATLAS_PDS_INVITE_BROKER_SECRET", "synthetic-broker-credential");
      vi.stubEnv("ATLAS_PUBLIC_URL", "https://atlas.test");
      vi.stubEnv("ATLAS_HOSTED_E2E_ENABLED", "1");
      vi.stubEnv("ATLAS_HOSTED_E2E_PRODUCTION_ENABLED", "1");
      vi.stubEnv("ATLAS_HOSTED_E2E_SECRET", "synthetic-hosted-verifier");
    }
    function pool() {
      if (!state.pool) throw new Error("Disposable database is unavailable.");
      return state.pool;
    }
    beforeAll(async () => {
      const testUrl = process.env.ATLAS_TEST_POSTGRES_URL;
      if (!testUrl) throw new Error("ATLAS_TEST_POSTGRES_URL is required.");
      const url = new URL(testUrl);
      if (!["postgres:", "postgresql:"].includes(url.protocol))
        throw new Error("ATLAS_TEST_POSTGRES_URL must be a PostgreSQL URL.");
      admin = new Pool({ connectionString: url.toString() });
      await admin.query(`CREATE DATABASE "${database}"`);
      url.pathname = `/${database}`;
      state.pool = new Pool({ connectionString: url.toString() });
      vi.stubEnv("DATABASE_URL", url.toString());
      vi.stubEnv("ATLAS_PUBLIC_URL", "http://localhost:3000");
      vi.stubEnv("ATLAS_MULTI_USER", "false");
      vi.stubEnv(
        "ATLAS_AUTH_INTERNAL_SECRET",
        "synthetic-auth-secret-at-least-thirty-two-characters",
      );
      env();
      // Exercise the real Better Auth and Atlas migrations, including generated
      // foreign keys, rather than copying the expected cascade into a test schema.
      const auth = await vi.importActual<typeof AuthModule>("@/domains/access/server/auth");
      const instance = await auth.getAuth();
      authInstance = instance;
      await auth.runAtlasAuthMigrations(await instance.$context);
      authPool = auth.getAuthPgPool();
      await pool().query(
        "CREATE TABLE entries (id TEXT PRIMARY KEY); CREATE TABLE profile_claims (id TEXT PRIMARY KEY); CREATE TABLE profile_claim_proofs (id TEXT PRIMARY KEY)",
      );
      await pool().query(
        await readFile(
          new URL("../../../../../../api/atlas/models/schema_parts/04.sql", import.meta.url),
          "utf8",
        ),
      );
      for (const table of [
        "atproto_oauth_app_state",
        "atproto_oauth_state",
        "atproto_oauth_session",
      ])
        await pool().query(
          `CREATE TABLE ${table} (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
        );
    });
    afterAll(async () => {
      await authPool?.end();
      await state.pool?.end();
      state.pool = null;
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        await admin.end();
      }
    });
    beforeEach(async () => {
      env();
      state.ensureAuthReady.mockResolvedValue(authInstance);
      await pool().query(
        'TRUNCATE "user", "organization", atproto_identities, workspace_products, atproto_oauth_app_state, atproto_oauth_state, atproto_oauth_session CASCADE',
      );
      const seeds = buildHostedE2EAccountSeeds(runId);
      for (const [id, email, name] of [
        [ownerId, seeds.owner.email, seeds.owner.name],
        [delegateId, seeds.delegate.email, seeds.delegate.name],
        [outsiderId, "person@example.org", "Person"],
      ]) {
        await pool().query(
          'INSERT INTO "user" (id,email,name,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,now(),now())',
          [id, email, name],
        );
        await pool().query(
          'INSERT INTO "session" (id,token,"userId","expiresAt","createdAt","updatedAt") VALUES ($1,$1,$2,now()+interval \'1 day\',now(),now())',
          [`session_${id}`, id],
        );
        await pool().query(
          'INSERT INTO "passkey" (id,"publicKey","userId","credentialID",counter,"deviceType","backedUp","createdAt") VALUES ($1,$1,$2,$1,0,\'singleDevice\',false,now())',
          [`passkey_${id}`, id],
        );
      }
      for (const [id, userId, name] of [
        ["fixture_workspace", ownerId, `${seeds.owner.name}'s Workspace`],
        ["real_workspace", outsiderId, "Real Workspace"],
      ]) {
        await pool().query(
          'INSERT INTO "organization" (id,name,slug,"createdAt") VALUES ($1,$2,$1,now())',
          [id, name],
        );
        await pool().query(
          'INSERT INTO "member" (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,\'owner\',now())',
          [`member_${id}`, id, userId],
        );
        await pool().query(
          "INSERT INTO workspace_products (id,workspace_id,product) VALUES ($1,$2,'team')",
          [`product_${id}`, id],
        );
      }
      const handles = [
        seeds.owner.handle,
        seeds.delegate.handle,
        "a382465815971g.pds.example.org",
        "real.pds.example.org",
      ];
      for (const [index, handle] of handles.entries()) {
        const id = `identity_${index}`;
        await pool().query(
          "INSERT INTO atproto_identities (id,did,current_handle,pds_url,created_at,updated_at) VALUES ($1,$2,$3,$4,now(),now())",
          [id, `did:plc:fixture${index}`, handle, pds],
        );
        await pool().query(
          "INSERT INTO user_atproto_controls (id,identity_id,user_id,status,created_at,updated_at) VALUES ($1,$1,$2,'active',now(),now())",
          [id, index === 3 ? outsiderId : index === 1 ? delegateId : ownerId],
        );
      }
      await pool().query(
        "INSERT INTO organization_atproto_identities (id,organization_id,identity_id,status,attached_by,attached_at,created_at,updated_at) VALUES ('org_link','fixture_workspace','identity_2','active',$1,now(),now(),now())",
        [ownerId],
      );
      await pool().query(
        "INSERT INTO atproto_identity_delegations (id,organization_id,identity_id,controller_user_id,delegate_user_id,status,granted_by,granted_at,created_at,updated_at) VALUES ('delegation','fixture_workspace','identity_2',$1,$2,'active',$1,now(),now(),now())",
        [ownerId, delegateId],
      );
      await pool().query(
        "INSERT INTO atproto_oauth_session (key,value) VALUES ('did:plc:fixture0','{}'),('did:plc:fixture3','{}')",
      );
      await pool().query(
        "INSERT INTO atproto_oauth_app_state (key,value) VALUES ('fixture_state',$1),('real_state',$2)",
        [JSON.stringify({ userId: ownerId }), JSON.stringify({ userId: outsiderId })],
      );
      await pool().query(
        "INSERT INTO atproto_oauth_state (key,value) VALUES ('fixture_oauth',$1),('real_oauth',$2)",
        [JSON.stringify({ appState: "fixture_state" }), JSON.stringify({ appState: "real_state" })],
      );
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          if (init?.method === "GET")
            return Promise.resolve(Response.json({ hostedFixtureCleanup: true }));
          if (typeof init?.body !== "string") throw new Error("Expected fixture request JSON.");
          const payload = JSON.parse(init.body) as { accounts: { handle: string }[] };
          return Promise.resolve(
            Response.json({ cleanedHandles: payload.accounts.map((account) => account.handle) }),
          );
        }),
      );
    });
    afterEach(() => vi.restoreAllMocks());
    async function count(table: string) {
      return Number(
        (await pool().query<{ count: string }>(`SELECT count(*) FROM "${table}"`)).rows[0]?.count,
      );
    }
    test("deletes only run-owned records and verifies real foreign-key cascades", async () => {
      const result = await cleanupHostedE2ERun(buildHostedE2EAccountSeeds(runId));
      expect(await result.json()).toEqual({
        ok: true,
        runId,
        deleted: { users: 2, workspaces: 1, identities: 3 },
      });
      for (const table of [
        "user",
        "organization",
        "session",
        "passkey",
        "member",
        "workspace_products",
        "atproto_identities",
        "user_atproto_controls",
        "atproto_oauth_session",
        "atproto_oauth_app_state",
        "atproto_oauth_state",
      ])
        expect(await count(table), table).toBe(1);
      expect(await count("atproto_identity_delegations")).toBe(0);
      expect(await count("organization_atproto_identities")).toBe(0);
      expect((await pool().query('SELECT id FROM "user"')).rows).toEqual([{ id: outsiderId }]);
      expect(await (await cleanupHostedE2ERun(buildHostedE2EAccountSeeds(runId))).json()).toEqual({
        ok: true,
        runId,
        deleted: { users: 0, workspaces: 0, identities: 0 },
      });
    });
    test("retains all database records when provider deletion cannot be verified", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) =>
          Promise.resolve(
            init?.method === "GET"
              ? Response.json({ hostedFixtureCleanup: true })
              : new Response("private provider error", { status: 502 }),
          ),
        ),
      );
      await expect(cleanupHostedE2ERun(buildHostedE2EAccountSeeds(runId))).rejects.toThrow(
        "Hosted E2E cleanup could not be verified.",
      );
      expect(await count("user")).toBe(3);
      expect(await count("atproto_identities")).toBe(4);
      expect(await count("workspace_products")).toBe(2);
    });
    test("retains a fixture workspace that has acquired another person's membership", async () => {
      await pool().query(
        'INSERT INTO "member" (id,"organizationId","userId",role,"createdAt") VALUES (\'foreign_member\',\'fixture_workspace\',$1,\'member\',now())',
        [outsiderId],
      );
      await expect(cleanupHostedE2ERun(buildHostedE2EAccountSeeds(runId))).rejects.toThrow();
      expect(await count("user")).toBe(3);
      expect(await count("member")).toBe(3);
    });
    test("retains all records if a fixture identity is linked to another person's account", async () => {
      await pool().query(
        "INSERT INTO user_atproto_controls (id,identity_id,user_id,status,created_at,updated_at) VALUES ('foreign_control','identity_0',$1,'disconnected',now(),now())",
        [outsiderId],
      );
      await expect(cleanupHostedE2ERun(buildHostedE2EAccountSeeds(runId))).rejects.toThrow();
      expect(await count("atproto_identities")).toBe(4);
    });
    test("removes the first inserted account if preparation fails before inserting the second", async () => {
      await pool().query(
        'TRUNCATE "user", "organization", atproto_identities, workspace_products, atproto_oauth_app_state, atproto_oauth_state, atproto_oauth_session CASCADE',
      );
      const context = await authInstance.$context;
      const createUser = context.internalAdapter.createUser.bind(context.internalAdapter);
      vi.spyOn(context.internalAdapter, "createUser")
        .mockImplementationOnce(createUser)
        .mockRejectedValueOnce(new Error("Synthetic second-account failure"));
      const response = await handleHostedE2EIdentityRequest(
        new Request("https://atlas.test/api/e2e/hosted/identity", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-atlas-hosted-e2e-secret": "synthetic-hosted-verifier", // pragma: allowlist secret - synthetic test credential
          },
          body: JSON.stringify({ action: "prepare", runId }),
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Hosted E2E preparation failed; temporary accounts were removed.",
      });
      expect(await count("user")).toBe(0);
    });
  },
);
