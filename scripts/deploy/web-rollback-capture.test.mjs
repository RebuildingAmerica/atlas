import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureVercelRollback,
  validateVercelRollback,
} from "./web-rollback-capture.mjs";

const input = {
  target: "production",
  hostname: "atlas.example.com",
  owner: "operator@example.com",
  project: "prj_atlas",
  team: "team_atlas",
  token: "private-provider-token",
  accountId: "a".repeat(32),
  zoneId: "b".repeat(32),
};
const alias = {
  alias: input.hostname,
  projectId: input.project,
  deploymentId: "dpl_original",
  protectionBypass: { secret: "private-bypass" },
  creator: { email: "private-creator" },
};
const deployment = {
  id: "dpl_original",
  projectId: input.project,
  target: "production",
  readyState: "READY",
  url: "atlas-original.vercel.app",
  meta: { githubCommitSha: "c".repeat(40) },
  routes: [
    {
      src: "/api/entities",
      dest: "https://api.example.com/api/entities",
      headers: { Authorization: "private-route-token" },
    },
  ],
  env: { DATABASE_URL: "private-database" },
};
const record = {
  id: "d".repeat(32),
  name: input.hostname,
  type: "CNAME",
  content: "cname.vercel-dns-017.com",
  proxied: false,
  ttl: 1,
};
function providers(patch = {}) {
  const calls = [];
  const cloudflare = (args) => {
    calls.push(args);
    if (args[0] === "zones")
      return {
        id: input.zoneId,
        name: "example.com",
        account: { id: input.accountId },
      };
    return patch.records ?? [patch.record ?? record];
  };
  const fetcher = async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer " + input.token);
    assert.equal(new URL(url).searchParams.get("teamId"), input.team);
    return Response.json(
      new URL(url).pathname.includes("/aliases/")
        ? (patch.alias ?? alias)
        : (patch.deployment ?? deployment),
    );
  };
  return { calls, cloudflare, fetcher };
}
test("captures a real immutable Vercel recovery target and exact DNS without secrets or provider writes", async () => {
  const p = providers();
  const snapshot = await captureVercelRollback({ ...input, ...p });
  assert.equal(snapshot.vercel.deploymentId, "dpl_original");
  assert.deepEqual(snapshot.dns, record);
  assert.equal(snapshot.owner, input.owner);
  assert.match(snapshot.vercel.routingDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(snapshot).includes("private"), false);
  assert.ok(
    p.calls.every((args) => args.includes("list") || args.includes("get")),
  );
  assert.doesNotThrow(() => validateVercelRollback(snapshot, input));
});
test("refuses wrong projects, redirects, failed deployments, changed account and non-Vercel DNS", async () => {
  for (const patch of [
    { alias: { ...alias, projectId: "prj_other" } },
    { alias: { ...alias, redirect: "outside.example.com" } },
    { deployment: { ...deployment, readyState: "ERROR" } },
    { deployment: { ...deployment, target: "preview" } },
    { record: { ...record, content: "outside.example.com" } },
    { record: { ...record, proxied: true } },
  ])
    await assert.rejects(() =>
      captureVercelRollback({ ...input, ...providers(patch) }),
    );
  const snapshot = await captureVercelRollback({ ...input, ...providers() });
  for (const patch of [
    { accountId: "e".repeat(32) },
    { hostname: "other.example.com" },
    { project: "prj_other" },
    { target: "staging" },
  ])
    assert.throws(() =>
      validateVercelRollback(snapshot, { ...input, ...patch }),
    );
});

test("coexisting mail and verification records are preserved alongside the routing CNAME", async () => {
  const mail = {
    id: "e".repeat(32),
    name: input.hostname,
    type: "MX",
    content: "mail.example.com",
    priority: 10,
    ttl: 3600,
  };
  const verification = {
    id: "f".repeat(32),
    name: input.hostname,
    type: "TXT",
    content: "public-domain-verification",
    ttl: 3600,
  };
  const snapshot = await captureVercelRollback({
    ...input,
    ...providers({ records: [record, mail, verification] }),
  });
  assert.deepEqual(snapshot.otherDnsRecords, [mail, verification]);
});

test("provider-reported null routes remain explicit while retaining the immutable deployment recovery target", async () => {
  const snapshot = await captureVercelRollback({
    ...input,
    ...providers({ deployment: { ...deployment, routes: null } }),
  });
  assert.equal(snapshot.vercel.routeInventory, "provider-null");
  assert.equal(snapshot.vercel.routeCount, null);
  assert.equal(snapshot.vercel.deploymentId, deployment.id);
  assert.doesNotThrow(() => validateVercelRollback(snapshot, input));
  await assert.rejects(() =>
    captureVercelRollback({
      ...input,
      ...providers({ deployment: { ...deployment, routes: undefined } }),
    }),
  );
});
