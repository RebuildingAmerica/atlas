import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { restoreVercelRouting } from "./web-rollback.mjs";

const id = (letter) => letter.repeat(32);
const snapshot = {
  schemaVersion: 1,
  target: "production",
  hostname: "atlas.example.com",
  owner: "ops@example.com",
  accountId: id("a"),
  zoneId: id("b"),
  collectedAt: "2026-10-10T00:00:00Z",
  dns: {
    id: id("c"),
    name: "atlas.example.com",
    type: "CNAME",
    content: "atlas.vercel-dns-017.com",
    proxied: false,
    ttl: 1,
  },
  otherDnsRecords: [
    {
      id: id("d"),
      name: "atlas.example.com",
      type: "MX",
      content: "mail.example.com",
      priority: 10,
      ttl: 3600,
    },
  ],
  vercel: {
    projectId: "prj_atlas",
    teamId: "team_atlas",
    deploymentId: "dpl_original",
    deploymentUrl: "https://original.vercel.app",
    routingDigest: createHash("sha256").update("null").digest("hex"),
    routeInventory: "provider-null",
    routeCount: null,
  },
};
const deployment = {
  target: "production",
  architecture: "workers",
  releaseSha: "a".repeat(40),
  workerName: "atlas-workers-production-aaaaaaaaaaaa",
  workerVersionId: "12345678-1234-1234-1234-123456789abc",
  artifactDigest: "b".repeat(64),
  assetsDigest: "c".repeat(64),
  accountId: snapshot.accountId,
  zoneId: snapshot.zoneId,
  candidateUrl:
    "https://atlas-workers-production-aaaaaaaaaaaa.atlas.example.com",
  publicEnv: {
    ATLAS_PUBLIC_URL: "https://atlas.example.com",
    ATLAS_WEB_CANONICAL_URL: "https://atlas.example.com",
  },
};
const expected = {
  target: snapshot.target,
  hostname: snapshot.hostname,
  owner: snapshot.owner,
  project: snapshot.vercel.projectId,
  team: snapshot.vercel.teamId,
  accountId: snapshot.accountId,
  zoneId: snapshot.zoneId,
};
function fixture() {
  const calls = [];
  const state = {
    domains: [snapshot.hostname, new URL(deployment.candidateUrl).hostname],
    records: [
      ...snapshot.otherDnsRecords,
      {
        id: id("e"),
        name: snapshot.hostname,
        type: "AAAA",
        content: "100::",
        proxied: true,
        ttl: 1,
      },
    ],
    journal: undefined,
  };
  const cloudflare = (args, options) => {
    calls.push({ args, body: options?.body });
    if (args[0] === "zones")
      return {
        id: snapshot.zoneId,
        name: "example.com",
        account: { id: snapshot.accountId },
      };
    if (args[0] === "workers" && args[1] === "get")
      return {
        name: deployment.workerName,
        references: {
          domains: state.domains.map((hostname) => ({
            hostname,
            zone_id: snapshot.zoneId,
          })),
        },
      };
    if (args[0] === "workers")
      return {
        deployments: [
          {
            versions: [
              { version_id: deployment.workerVersionId, percentage: 100 },
            ],
          },
        ],
      };
    if (args[2] === "list") return state.records;
    assert.deepEqual(args.slice(0, 3), ["dns", "records", "batch"]);
    const body = options.body;
    assert.ok(
      body.deletes.every(
        (record) =>
          !snapshot.otherDnsRecords.some((mail) => mail.id === record.id),
      ),
    );
    state.records = [
      ...state.records.filter(
        (record) => !body.deletes.some((entry) => entry.id === record.id),
      ),
      ...body.posts.map((record) => ({ ...record, id: id("f") })),
    ];
    return {};
  };
  const applyDomains = async (domains) => {
    calls.push({ domains });
    state.domains = domains;
    state.records = state.records.filter((row) => row.type !== "AAAA");
  };
  const fetcher = async (url) =>
    Response.json(
      new URL(url).pathname.includes("aliases")
        ? {
            alias: snapshot.hostname,
            projectId: expected.project,
            deploymentId: snapshot.vercel.deploymentId,
          }
        : {
            id: snapshot.vercel.deploymentId,
            projectId: expected.project,
            target: "production",
            readyState: "READY",
            url: "original.vercel.app",
            routes: null,
          },
    );
  return {
    calls,
    state,
    options: {
      snapshot,
      deployment,
      expected,
      token: "private-token",
      cloudflare,
      applyDomains,
      fetcher,
      checkpoint: (journal) => {
        state.journal = journal;
      },
    },
  };
}
test("rollback doctor verifies the retained Vercel deployment and never changes routing", async () => {
  const f = fixture();
  assert.equal((await restoreVercelRouting(f.options)).status, "ready");
  assert.ok(f.calls.every((call) => !call.domains && !call.body));
  assert.equal(f.state.journal, undefined);
});
test("rollback detaches only Atlas's canonical Worker domain and restores CNAME without touching mail", async () => {
  const f = fixture();
  const result = await restoreVercelRouting({ ...f.options, apply: true });
  assert.equal(result.status, "routing-restored");
  assert.deepEqual(f.state.domains, [
    new URL(deployment.candidateUrl).hostname,
  ]);
  assert.deepEqual(
    f.state.records.filter((row) => row.type === "MX"),
    snapshot.otherDnsRecords,
  );
  assert.equal(
    f.state.records.find((row) => row.type === "CNAME").content,
    snapshot.dns.content,
  );
  assert.equal(f.state.journal.phase, "restored");
  const mutationCount = f.calls.filter(
    (call) => call.body || call.domains,
  ).length;
  await restoreVercelRouting({
    ...f.options,
    apply: true,
    journal: f.state.journal,
  });
  assert.equal(
    f.calls.filter((call) => call.body || call.domains).length,
    mutationCount,
  );
});
test("rollback refuses changed release, alias, mail records and unrelated domains before mutations", async () => {
  for (const kind of ["version", "alias", "mail", "domain"]) {
    const f = fixture();
    const options = { ...f.options, apply: true };
    if (kind === "version")
      options.deployment = {
        ...deployment,
        workerVersionId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      };
    if (kind === "alias")
      options.fetcher = async () =>
        Response.json({
          alias: snapshot.hostname,
          projectId: expected.project,
          deploymentId: "dpl_other",
        });
    if (kind === "mail")
      f.state.records[0] = {
        ...f.state.records[0],
        content: "changed.example.com",
      };
    if (kind === "domain") f.state.domains.push("unrelated.example.com");
    await assert.rejects(() => restoreVercelRouting(options));
    assert.ok(f.calls.every((call) => !call.body && !call.domains));
  }
});
test("an interrupted detach can resume only with the exact pre-mutation recovery journal", async () => {
  const f = fixture();
  await assert.rejects(() =>
    restoreVercelRouting({
      ...f.options,
      apply: true,
      applyDomains: async (domains) => {
        f.state.domains = domains;
        throw new Error("interrupted");
      },
    }),
  );
  assert.equal(f.state.journal.phase, "prepared");
  await assert.rejects(() =>
    restoreVercelRouting({ ...f.options, apply: true }),
  );
  assert.equal(
    (
      await restoreVercelRouting({
        ...f.options,
        apply: true,
        journal: f.state.journal,
      })
    ).status,
    "routing-restored",
  );
});
