import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureApiRuntimeSnapshot,
  createApiRollbackPlan,
  restoreApiRuntimeSnapshot,
} from "./api-runtime-rollback.mjs";

const accountId = "a".repeat(32);
const env = { CLOUDFLARE_ACCOUNT_ID: accountId };
const version = (char) =>
  `${char.repeat(8)}-${char.repeat(4)}-${char.repeat(4)}-${char.repeat(4)}-${char.repeat(12)}`;
function runtimes(revision = "1") {
  return Object.fromEntries(
    ["api", "discovery"].map((key, index) => [
      key,
      {
        workerName: `atlas-${key}`,
        releaseSha: revision.repeat(40),
        artifactDigest: revision.repeat(64),
        workerVersionId: version(String(Number(revision) + index)),
        namespaceId: String(index + 1).repeat(32),
        namespaceClass: "ApiRuntime",
        storage: "sqlite",
      },
    ]),
  );
}
function provider(initial = runtimes()) {
  const active = structuredClone(initial);
  const mutations = [];
  let failAfterWrite = false;
  return {
    active,
    mutations,
    loseNextResponse() {
      failAfterWrite = true;
    },
    cf(command, options) {
      const workerName = command[command.indexOf("--worker") + 1];
      const key = ["api", "discovery"].find(
        (name) => active[name].workerName === workerName,
      );
      if (command.slice(0, 3).join(" ") === "durable-objects namespaces list")
        return Object.values(active).map((row) => ({
          id: row.namespaceId,
          script: row.workerName,
          class: row.namespaceClass,
          use_sqlite: true,
        }));
      if (command.slice(0, 3).join(" ") === "workers deployments list")
        return {
          deployments: [
            {
              versions: [
                { version_id: active[key].workerVersionId, percentage: 100 },
              ],
            },
          ],
        };
      if (command.slice(0, 3).join(" ") === "workers versions get")
        return { id: command[3] };
      if (command.slice(0, 3).join(" ") === "workers deployments create") {
        assert.equal(command.includes("--bypass-deployment-checks"), false);
        assert.deepEqual(Object.keys(options.body).sort(), [
          "strategy",
          "versions",
        ]);
        assert.equal(options.body.strategy, "percentage");
        assert.equal(options.body.versions[0].percentage, 100);
        active[key].workerVersionId = options.body.versions[0].version_id;
        mutations.push(key);
        if (failAfterWrite) {
          failAfterWrite = false;
          throw new Error("private-provider-detail");
        }
        return { id: "deployment" };
      }
      assert.fail(`Unexpected command: ${command.join(" ")}`);
    },
  };
}
function fixture() {
  const old = runtimes("1");
  const current = runtimes("3");
  const mock = provider(old);
  const snapshot = captureApiRuntimeSnapshot({
    accountId,
    runtimeReleases: old,
    env,
    cloudflare: mock.cf,
  });
  const plan = createApiRollbackPlan({ snapshot, current });
  Object.assign(mock.active, structuredClone(current));
  return { old, current, snapshot, plan, mock };
}

test("capture reads both exact active versions and SQLite namespaces without writes", () => {
  const { snapshot, old, mock } = fixture();
  assert.deepEqual(snapshot.runtimeReleases, old);
  assert.match(snapshot.snapshotId, /^[a-f0-9]{64}$/);
  assert.deepEqual(mock.mutations, []);
  assert.throws(
    () =>
      captureApiRuntimeSnapshot({
        accountId,
        runtimeReleases: runtimes(),
        env: {},
        cloudflare: mock.cf,
      }),
    /account/,
  );
});

test("snapshot refuses changed versions and namespaces", () => {
  const mock = provider(runtimes());
  mock.active.api.workerVersionId = version("f");
  assert.throws(
    () =>
      captureApiRuntimeSnapshot({
        accountId,
        runtimeReleases: runtimes(),
        env,
        cloudflare: mock.cf,
      }),
    /readback/,
  );
  mock.active.api = runtimes().api;
  mock.active.discovery.namespaceId = "f".repeat(32);
  assert.throws(
    () =>
      captureApiRuntimeSnapshot({
        accountId,
        runtimeReleases: runtimes(),
        env,
        cloudflare: mock.cf,
      }),
    /readback/,
  );
});

test("rollback plans retain commit/artifact identity and reject migrations or tampering", () => {
  const { plan, snapshot, current } = fixture();
  assert.deepEqual(plan.snapshot.runtimeReleases, runtimes());
  assert.deepEqual(plan.current, current);
  for (const field of ["workerName", "namespaceId", "namespaceClass"]) {
    const changed = structuredClone(current);
    changed.api[field] =
      field === "namespaceId" ? "f".repeat(32) : "OtherRuntime";
    assert.throws(() => createApiRollbackPlan({ snapshot, current: changed }));
  }
  const changed = structuredClone(snapshot);
  changed.runtimeReleases.api.artifactDigest = "f".repeat(64);
  assert.throws(
    () => createApiRollbackPlan({ snapshot: changed, current }),
    /snapshot identity/,
  );
  assert.throws(
    () =>
      createApiRollbackPlan({
        snapshot,
        current: {
          ...current,
          api: {
            ...current.api,
            workerVersionId: snapshot.runtimeReleases.api.workerVersionId,
          },
        },
      }),
    /version has conflicting/,
  );
});

test("read-only preparation verifies all recoverable versions before any mutation", async () => {
  const { plan, mock } = fixture();
  const report = await restoreApiRuntimeSnapshot({
    plan,
    env,
    cloudflare: mock.cf,
  });
  assert.equal(report.status, "ready");
  assert.equal(report.readbackPassed, undefined);
  assert.deepEqual(mock.mutations, []);
});

test("restore uses cf immutable deployments and verifies both runtimes plus real journeys", async () => {
  const { plan, old, mock } = fixture();
  const journals = [];
  let probed = false;
  const result = await restoreApiRuntimeSnapshot({
    plan,
    env,
    cloudflare: mock.cf,
    apply: true,
    checkpoint: (journal) => journals.push(structuredClone(journal)),
    probe: async (input) => {
      assert.deepEqual(input.runtimeReleases, old);
      assert.equal(mock.active.api.workerVersionId, old.api.workerVersionId);
      assert.equal(
        mock.active.discovery.workerVersionId,
        old.discovery.workerVersionId,
      );
      probed = true;
      return {
        status: "pass",
        evidenceReference: ".atlas/real-journey-report.json",
      };
    },
  });
  assert.deepEqual(mock.mutations, ["discovery", "api"]);
  assert.equal(probed, true);
  assert.equal(result.readbackPassed, true);
  assert.deepEqual(result.runtimeReleases, old);
  assert.equal(journals.at(-1).phase, "verified");
  assert.equal(
    JSON.stringify(result).includes("private-provider-detail"),
    false,
  );
});

test("a successful write with a lost response resumes from provider state without replay", async () => {
  const { plan, mock } = fixture();
  let journal;
  const checkpoint = (value) => {
    journal = structuredClone(value);
  };
  mock.loseNextResponse();
  await assert.rejects(
    restoreApiRuntimeSnapshot({
      plan,
      env,
      cloudflare: mock.cf,
      apply: true,
      checkpoint,
      probe: async () => ({ status: "pass", evidenceReference: "report" }),
    }),
    (error) => !error.message.includes("private-provider-detail"),
  );
  assert.equal(journal.phase, "restoring");
  assert.deepEqual(mock.mutations, ["discovery"]);
  await restoreApiRuntimeSnapshot({
    plan,
    journal,
    env,
    cloudflare: mock.cf,
    apply: true,
    checkpoint,
    probe: async () => ({ status: "pass", evidenceReference: "report" }),
  });
  assert.deepEqual(mock.mutations, ["discovery", "api"]);
  assert.equal(journal.phase, "verified");
});

test("all preflight failures stop before writes, including unrelated releases and missing target versions", async () => {
  for (const failure of [
    "unknown-active",
    "missing-old-version",
    "wrong-journal",
    "changed-plan",
    "missing-probe",
    "missing-checkpoint",
  ]) {
    const { plan, mock } = fixture();
    const options = {
      plan,
      env,
      cloudflare: mock.cf,
      apply: true,
      checkpoint() {},
      probe: async () => ({ status: "pass", evidenceReference: "report" }),
    };
    if (failure === "unknown-active")
      mock.active.api.workerVersionId = version("f");
    if (failure === "missing-old-version")
      options.cloudflare = (command, args) =>
        command.slice(0, 3).join(" ") === "workers versions get"
          ? { id: version("f") }
          : mock.cf(command, args);
    if (failure === "wrong-journal")
      options.journal = {
        planId: "f".repeat(64),
        phase: "prepared",
        completed: [],
      };
    if (failure === "changed-plan")
      options.plan = { ...plan, planId: "f".repeat(64) };
    if (failure === "missing-probe") delete options.probe;
    if (failure === "missing-checkpoint") delete options.checkpoint;
    await assert.rejects(restoreApiRuntimeSnapshot(options));
    assert.deepEqual(mock.mutations, [], failure);
  }
});

test("failed real journeys retain restored versions without claiming complete verification", async () => {
  const { plan, mock } = fixture();
  let journal;
  await assert.rejects(
    restoreApiRuntimeSnapshot({
      plan,
      env,
      cloudflare: mock.cf,
      apply: true,
      checkpoint: (value) => {
        journal = value;
      },
      probe: async () => ({ status: "fail", evidenceReference: "report" }),
    }),
    /rollback stopped/,
  );
  assert.equal(journal.phase, "versions-restored");
  assert.deepEqual(mock.mutations, ["discovery", "api"]);
});

test("concurrent replacement before the next write cannot be overwritten by rollback", async () => {
  const { plan, mock } = fixture();
  await assert.rejects(
    restoreApiRuntimeSnapshot({
      plan,
      env,
      cloudflare: mock.cf,
      apply: true,
      checkpoint(journal) {
        if (journal.completed.includes("discovery"))
          mock.active.api.workerVersionId = version("f");
      },
      probe: async () => ({ status: "pass", evidenceReference: "report" }),
    }),
    /rollback stopped/,
  );
  assert.deepEqual(mock.mutations, ["discovery"]);
});

test("provider drift during hosted probes prevents a verified result", async () => {
  const { plan, mock } = fixture();
  let journal;
  await assert.rejects(
    restoreApiRuntimeSnapshot({
      plan,
      env,
      cloudflare: mock.cf,
      apply: true,
      checkpoint: (value) => {
        journal = value;
      },
      probe: async () => {
        mock.active.api.workerVersionId = version("f");
        return { status: "pass", evidenceReference: "report" };
      },
    }),
    /rollback stopped/,
  );
  assert.equal(journal.phase, "versions-restored");
});

test("provider exceptions in read-only preflight never expose private diagnostics", async () => {
  const { plan } = fixture();
  await assert.rejects(
    restoreApiRuntimeSnapshot({
      plan,
      env,
      cloudflare() {
        throw new Error("private-provider-detail");
      },
    }),
    (error) =>
      !error.message.includes("private-provider-detail") &&
      error.cause === undefined,
  );
});
