import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareOperationsOutput } from "./api-cloudflare-release.mjs";
import { changePublicApiRouting, routeClient } from "./api-public-routing.mjs";

const accountId = "b".repeat(32),
  zoneId = "c".repeat(32);
const publicHostname = "api.example.org";
const operationsHostname = "atlas-api-ops-production.example.org";
const version = "11111111-1111-1111-1111-111111111111";

async function fixture(t) {
  const artifact = mkdtempSync(join(tmpdir(), "atlas-public-route-"));
  t.after(() => rmSync(artifact, { recursive: true, force: true }));
  const built = await prepareOperationsOutput({
    destination: artifact,
    accountId,
    target: "production",
    hostname: operationsHostname,
    publicHostname,
  });
  const unrelated = {
    id: "d".repeat(32),
    pattern: "other.example.org/*",
    script: "other",
  };
  const state = {
    rows: [unrelated],
    journals: [],
    mutations: [],
    version,
    probes: [],
  };
  const manifest = {
    target: "production",
    status: "verified-active",
    accountId,
    releaseSha: "a".repeat(40),
    runtimeReleases: Object.fromEntries(
      ["api", "discovery"].map((role) => [
        role,
        {
          workerName: `atlas-${role}-production`,
          releaseSha: "a".repeat(40),
          workerVersionId: version,
          artifactDigest: "0".repeat(64),
          namespaceId: (role === "api" ? "1" : "2").repeat(32),
          namespaceClass: role === "api" ? "ApiRuntime" : "DiscoveryRuntime",
          storage: "sqlite",
        },
      ]),
    ),
    operations: {
      hostname: operationsHostname,
      workerName: "atlas-api-ops-production",
      workerVersionId: version,
      artifactDigest: built.artifactDigest,
      accessAppId: "access",
    },
  };
  const options = {
    manifest,
    artifact,
    zoneId,
    publicHostname,
    operationsHostname,
    access: {
      id: "existing-access",
      client_id: "fixture-client",
      client_secret: "fixture-secret",
    },
    env: {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: "fixture-token",
    },
    cloudflare(args) {
      if (args[0] === "durable-objects")
        return Object.values(manifest.runtimeReleases).map((row) => ({
          id: row.namespaceId,
          script: row.workerName,
          class: row.namespaceClass,
          use_sqlite: true,
        }));
      if (args[1] === "deployments")
        return {
          deployments: [
            { versions: [{ version_id: state.version, percentage: 100 }] },
          ],
        };
      if (args[0] === "zero-trust")
        return {
          type: "self_hosted",
          domain: operationsHostname,
          policies: [
            {
              decision: "non_identity",
              include: [{ service_token: { token_id: "existing-access" } }],
            },
          ],
        };
      throw Error("Unexpected provider command");
    },
    routeApi: {
      list: async () => structuredClone(state.rows),
      create: async (body) => {
        state.mutations.push({ method: "POST", body });
        const row = { id: "e".repeat(32), ...body };
        state.rows.push(row);
        return row;
      },
      delete: async (id) => {
        state.mutations.push({ method: "DELETE", id });
        state.rows = state.rows.filter((row) => row.id !== id);
      },
    },
    checkpoint: async (journal) => state.journals.push(journal),
    fetcher: async (url, init) => {
      state.probes.push({ url, headers: init.headers });
      const path = new URL(url).pathname.replace(/^\/public-api/, "");
      if (path === "/health") return Response.json({ status: "ok" });
      if (path === "/api/entities") return Response.json({ items: [] });
      if (path.startsWith("/mcp"))
        return new Response(null, {
          status: 401,
          headers: { "www-authenticate": 'Bearer realm="Atlas"' },
        });
      return new Response(null, { status: 404 });
    },
  };
  return { state, options, unrelated };
}

test("route preview is read-only; promotion and restore touch only the retained API route", async (t) => {
  const { state, options, unrelated } = await fixture(t);
  assert.equal(
    (await changePublicApiRouting({ ...options, mode: "promote" })).status,
    "ready",
  );
  assert.deepEqual(state.mutations, []);
  const result = await changePublicApiRouting({
    ...options,
    mode: "promote",
    apply: true,
  });
  assert.equal(result.status, "verified");
  assert.deepEqual(state.mutations, [
    {
      method: "POST",
      body: {
        pattern: `${publicHostname}/*`,
        script: options.manifest.operations.workerName,
      },
    },
  ]);
  assert.ok(
    state.probes
      .filter((p) => new URL(p.url).hostname === publicHostname)
      .every((p) => Object.keys(p.headers).length === 0),
  );
  const restored = await changePublicApiRouting({
    ...options,
    mode: "restore",
    journal: result.journal,
    apply: true,
  });
  assert.equal(restored.status, "restored-routing");
  assert.deepEqual(state.rows, [unrelated]);
  assert.equal(state.mutations.at(-1).id, result.journal.routeId);
});

test("interrupted creation is reconciled without creating a second route", async (t) => {
  const { state, options } = await fixture(t);
  const create = options.routeApi.create;
  options.routeApi.create = async (body) => {
    await create(body);
    throw Error("interrupted");
  };
  await assert.rejects(
    changePublicApiRouting({ ...options, mode: "promote", apply: true }),
    /interrupted/,
  );
  assert.equal(state.journals.at(-1).phase, "route-attach-intent");
  options.routeApi.create = create;
  const result = await changePublicApiRouting({
    ...options,
    mode: "promote",
    journal: state.journals.at(-1),
    apply: true,
  });
  assert.equal(result.status, "verified");
  assert.equal(state.mutations.filter((m) => m.method === "POST").length, 1);
});

test("restore refuses changed ownership, duplicate routes and a changed active version", async (t) => {
  for (const mutation of [
    (state) => {
      state.rows.at(-1).script = "someone-else";
    },
    (state) => {
      state.rows.push({ ...state.rows.at(-1), id: "f".repeat(32) });
    },
    (state) => {
      state.version = "22222222-2222-2222-2222-222222222222";
    },
  ]) {
    const { state, options } = await fixture(t);
    const result = await changePublicApiRouting({
      ...options,
      mode: "promote",
      apply: true,
    });
    mutation(state);
    await assert.rejects(
      changePublicApiRouting({
        ...options,
        mode: "restore",
        journal: result.journal,
        apply: true,
      }),
    );
    assert.equal(state.mutations.length, 1);
  }
});

test("wildcard conflicts, forged journals and failed private probes cannot change routing", async (t) => {
  const { state, options } = await fixture(t);
  state.rows.push({
    id: "f".repeat(32),
    pattern: "https://*.example.org/api/*",
    script: "existing",
  });
  await assert.rejects(
    changePublicApiRouting({ ...options, mode: "promote", apply: true }),
    /route/,
  );
  state.rows.pop();
  const ready = await changePublicApiRouting({ ...options, mode: "promote" });
  await assert.rejects(
    changePublicApiRouting({
      ...options,
      mode: "promote",
      apply: true,
      journal: {
        ...ready.journal,
        snapshot: {
          ...ready.journal.snapshot,
          publicHostname: "other.example.org",
        },
      },
    }),
    /journal/,
  );
  await assert.rejects(
    changePublicApiRouting({
      ...options,
      mode: "promote",
      apply: true,
      fetcher: async () => new Response(null, { status: 503 }),
    }),
    /proof/,
  );
  assert.deepEqual(state.mutations, []);
});

test("the route client uses only an explicit bearer token and scoped REST route endpoints", async () => {
  const calls = [];
  const api = routeClient(
    zoneId,
    { CLOUDFLARE_API_TOKEN: "fixture-token" },
    async (url, init) => {
      calls.push({ url, ...init });
      return Response.json({
        success: true,
        result: init.method === "GET" ? [] : { id: "e".repeat(32) },
      });
    },
  );
  assert.deepEqual(await api.list(), []);
  await api.create({
    pattern: `${publicHostname}/*`,
    script: "atlas-api-ops-production",
  });
  await api.delete("e".repeat(32));
  assert.deepEqual(
    calls.map((c) => c.method),
    ["GET", "POST", "DELETE"],
  );
  assert.ok(
    calls.every(
      (c) =>
        c.url.startsWith(
          `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
        ) &&
        c.headers.authorization === "Bearer fixture-token" &&
        c.redirect === "error",
    ),
  );
  assert.throws(
    () => routeClient(zoneId, { ATLAS_CF_PROFILE: "local-profile" }),
    /explicit/i,
  );
  await assert.rejects(
    routeClient(zoneId, { CLOUDFLARE_API_TOKEN: "fixture-token" }, async () =>
      Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 2 },
      }),
    ).list(),
    /inventory/,
  );
});
