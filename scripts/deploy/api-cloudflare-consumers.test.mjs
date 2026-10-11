import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestDirectory } from "./web-release.mjs";
import { releaseMessage } from "./api-cloudflare-release.mjs";
import { assessWebRelease } from "./web-assess.mjs";
import {
  transitionApiConsumers,
  consumerReleaseMessage,
  reconcileConsumerJournal,
} from "./api-cloudflare-consumers.mjs";

const sha = "a".repeat(40),
  accountId = "b".repeat(32),
  schema = "c".repeat(64);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "atlas-consumers-test-"));
  const artifacts = {},
    runtimeReleases = {},
    versions = {},
    messages = {},
    calls = [],
    journals = [];
  for (const [index, role] of ["api", "discovery"].entries()) {
    const directory = join(root, role),
      out = join(directory, ".cloudflare/output/v0"),
      worker = join(out, "workers/default");
    mkdirSync(worker, { recursive: true });
    writeFileSync(join(out, "config.json"), JSON.stringify({ accountId }));
    writeFileSync(
      join(worker, "worker.config.json"),
      JSON.stringify({
        name: `atlas-${role}-staging`,
        workersDev: false,
        previewUrls: false,
        domains: [],
        env: {
          ATLAS_RELEASE_SHA: { type: "text", value: sha },
          ATLAS_ACTIVE_RELEASE_SHA: { type: "text", value: "" },
          ATLAS_SCHEMA_RECEIPT_DIGEST: { type: "text", value: schema },
          ATLAS_API_SETTINGS: { type: "secret" },
        },
      }),
    );
    artifacts[role] = { directory, artifactDigest: digestDirectory(out) };
    versions[role] = `${index + 1}`.repeat(8) + "-1111-1111-1111-111111111111";
    runtimeReleases[role] = {
      workerName: `atlas-${role}-staging`,
      workerVersionId: versions[role],
      releaseSha: sha,
      artifactDigest: artifacts[role].artifactDigest,
      namespaceId: `${index + 1}`.repeat(32),
      namespaceClass: role === "api" ? "ApiRuntime" : "DiscoveryRuntime",
      storage: "sqlite",
    };
    messages[role] = releaseMessage(
      "staging",
      role,
      artifacts[role].artifactDigest,
      schema,
    );
  }
  const manifest = {
    schemaVersion: 1,
    kind: "cloudflare-api-release",
    target: "staging",
    accountId,
    releaseSha: sha,
    schemaReceiptDigest: schema,
    status: "verified-paused",
    productionEligible: false,
    runtimeReleases,
  };
  const cloudflare = (cmd) => {
    if (cmd[0] === "durable-objects")
      return Object.values(runtimeReleases).map((r) => ({
        id: r.namespaceId,
        script: r.workerName,
        class: r.namespaceClass,
        use_sqlite: true,
      }));
    const role = cmd.at(-1).includes("discovery") ? "discovery" : "api";
    if (cmd[1] === "deployments")
      return {
        deployments: [
          { versions: [{ version_id: versions[role], percentage: 100 }] },
        ],
      };
    if (cmd[1] === "versions")
      return {
        id: versions[role],
        annotations: { "workers/tag": sha, "workers/message": messages[role] },
      };
    throw Error("Unexpected provider call");
  };
  const input = {
    mode: "pause",
    manifest,
    artifacts,
    destination: join(root, "transition"),
    env: {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: "test-explicit-session",
    },
    cloudflare,
    checkpoint: async (j) => journals.push(structuredClone(j)),
    deploy: async (artifact, options) => {
      const config = JSON.parse(
        readFileSync(
          join(
            artifact.directory,
            ".cloudflare/output/v0/workers/default/worker.config.json",
          ),
        ),
      );
      const role = config.name.includes("discovery") ? "discovery" : "api";
      assert.equal(
        config.env.ATLAS_ACTIVE_RELEASE_SHA.value,
        input.mode === "activate" ? sha : "",
      );
      assert.equal(options.settings, undefined);
      calls.push(role);
      versions[role] =
        `${role === "api" ? 3 : 4}`.repeat(8) + "-1111-1111-1111-111111111111";
      messages[role] = options.message;
    },
    probe: async ({ role, path }) => ({
      status: 200,
      body:
        path === "/__atlas/release"
          ? { releaseSha: sha, runtimeRole: role, schemaReceiptDigest: schema }
          : {
              releaseSha: sha,
              activeReleaseSha: input.mode === "activate" ? sha : "",
              enabled: input.mode === "activate",
            },
    }),
  };
  return {
    root,
    input,
    versions,
    messages,
    calls,
    journals,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

function activation(f) {
  const now = Date.now(),
    timestamp = new Date(now).toISOString();
  const runtimeReleases = {
    ...f.input.manifest.runtimeReleases,
    web: {
      ...f.input.manifest.runtimeReleases.api,
      workerName: "atlas-web-staging",
    },
  };
  f.input.mode = "activate";
  f.input.verifyPrivateRuntime = async () => ({
    private: true,
    accountId,
    releaseSha: sha,
  });
  f.input.ownership = {
    accountId,
    releaseSha: sha,
    verifiedAt: timestamp,
    legacyWorkersStopped: true,
    legacySchedulersStopped: true,
    evidenceReference: "retained/legacy-handoff.json",
  };
  f.input.activationEvidence = {
    releaseSha: sha,
    releasePolicy: {
      mode: "immediate",
      architecture: "cloudflare-durable",
      releaseSha: sha,
      authorizedBy: "Operator",
      authorizationReference: "User approved immediate cutover",
      authorizedAt: timestamp,
    },
    baseline: { days: 14, warmP95Ms: 500, windowEnd: timestamp },
    cloudflare: {
      accountId,
      plan: "free",
      collectedAt: timestamp,
      evidenceReference: "retained/account-usage.json",
      quotas: Object.fromEntries(
        [
          "workersRequestsPerDay",
          "durableRequestsPerDay",
          "durableGbSecondsPerDay",
          "durableRowsReadPerDay",
          "durableRowsWrittenPerDay",
          "durableStorageBytes",
          "hyperdriveQueriesPerDay",
        ].map((k) => [k, { candidate: 1, otherAccountUsage: 1 }]),
      ),
    },
    durable: {
      journeysPassed: true,
      warmP95Ms: 500,
      coldP95Ms: 2500,
      edgeCpuP99Ms: 1,
      edgeCpuLimitFailures: 0,
      addedMonthlyCosts: {
        databaseUsd: 0,
        networkUsd: 0,
        buildsUsd: 0,
        storageUsd: 0,
        logsUsd: 0,
      },
      runtimeReleases,
      measurements: Object.fromEntries(
        Object.entries(runtimeReleases).map(([role, r]) => [
          role,
          {
            ...r,
            provider: "cloudflare",
            evidenceReference: `retained/${role}-metrics.json`,
            collectedAt: timestamp,
            cpuP99Ms: 50,
            knownMemoryLimitBytes: 128 * 1024 * 1024,
            memoryLimitFailures: 0,
            providerLoad: {
              representativePassed: true,
              maxBoundedPayloadPassed: true,
              concurrencyPassed: true,
              scopeReference: "retained/load.json",
            },
            peakConnections: 2,
            limitFailures: 0,
            bundleStartupPassed: true,
            maxAlarmWallMs: 1000,
            resumableAlarmsPassed: true,
          },
        ]),
      ),
      rollback: {
        readbackPassed: true,
        evidenceReference: "retained/rollback.json",
        runtimeReleases,
      },
    },
  };
}

test("doctor verifies identities and retained bytes without deploying, copying, or reconciling", async () => {
  const f = fixture();
  try {
    const result = await transitionApiConsumers(f.input);
    assert.equal(result.status, "planned");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.journals, []);
    assert.throws(() =>
      readFileSync(
        join(f.input.destination, "api/.cloudflare/output/v0/config.json"),
      ),
    );
  } finally {
    f.close();
  }
});

test("pause retains distinct versions and namespace-safe rollback before claiming drained", async () => {
  const f = fixture();
  try {
    const before = structuredClone(f.input.manifest.runtimeReleases);
    const result = await transitionApiConsumers({ ...f.input, apply: true });
    assert.equal(result.status, "verified-paused");
    assert.deepEqual(f.calls, ["discovery", "api"]);
    assert.deepEqual(result.rollbackPlan.snapshot.runtimeReleases, before);
    assert.equal(
      result.rollbackPlan.current.api.workerVersionId,
      f.versions.api,
    );
    assert.equal(
      result.runtimeReleases.api.namespaceId,
      before.api.namespaceId,
    );
    assert.notEqual(
      result.runtimeReleases.api.artifactDigest,
      before.api.artifactDigest,
    );
    assert.equal(result.productionEligible, false);
    assert.equal(f.journals.at(-1).phase, "verified-paused");
    assert.ok(!JSON.stringify(f.journals).includes("not-in-journal"));
  } finally {
    f.close();
  }
});

test("private activation requires current quota preflight and legacy ownership evidence", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      transitionApiConsumers({ ...f.input, mode: "activate", apply: true }),
      /preflight|ownership/i,
    );
    assert.deepEqual(f.calls, []);
  } finally {
    f.close();
  }
});

test("artifact tampering and stale versions fail before any deployment", async () => {
  for (const tamper of [
    (f) =>
      writeFileSync(
        join(f.input.artifacts.api.directory, ".cloudflare/output/v0/extra"),
        "changed",
      ),
    (f) => {
      f.versions.api = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    },
    (f) => {
      f.messages.api = "another artifact";
    },
    (f) => {
      delete f.input.env.CLOUDFLARE_API_TOKEN;
      f.input.env.ATLAS_CF_PROFILE = "must-not-look-up";
    },
  ]) {
    const f = fixture();
    try {
      tamper(f);
      await assert.rejects(transitionApiConsumers({ ...f.input, apply: true }));
      assert.deepEqual(f.calls, []);
    } finally {
      f.close();
    }
  }
});

test("failed reconciliation keeps partial deployment identities and never claims pause", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      transitionApiConsumers({
        ...f.input,
        apply: true,
        probe: async () => ({ status: 503 }),
      }),
      /probe|reconcil/i,
    );
    assert.equal(f.journals.at(-1).phase, "verification-required");
    assert.equal(f.journals.at(-1).manifest.status, "verification-required");
    assert.equal(
      f.journals.at(-1).manifest.rollbackPlan.current.discovery.workerVersionId,
      f.versions.discovery,
    );
    assert.deepEqual(f.calls, ["discovery"]);
  } finally {
    f.close();
  }
});

test("activation changes only the binding and records the new exact deployment pair", async () => {
  const f = fixture();
  try {
    activation(f);
    const before = JSON.parse(
      readFileSync(
        join(
          f.input.artifacts.api.directory,
          ".cloudflare/output/v0/workers/default/worker.config.json",
        ),
      ),
    );
    const result = await transitionApiConsumers({ ...f.input, apply: true });
    assert.equal(result.status, "verified-active");
    assert.deepEqual(f.calls, ["api", "discovery"]);
    const after = JSON.parse(
      readFileSync(
        join(
          result.artifacts.api.directory,
          ".cloudflare/output/v0/workers/default/worker.config.json",
        ),
      ),
    );
    before.env.ATLAS_ACTIVE_RELEASE_SHA.value = sha;
    assert.deepEqual(after, before);
    assert.equal(result.productionEligible, false);
    assert.equal(result.runtimeReleases.api.workerVersionId, f.versions.api);
    assert.ok(result.transition.ownershipDigest);
    assert.ok(result.transition.preflightEvidenceDigest);
    assert.equal(f.journals.at(-1).phase, "verified-active");
    assert.match(f.messages.api, /consumers active=/);
  } finally {
    f.close();
  }
});

test("stale quotas, wrong release and missing handoff prevent private activation", async () => {
  for (const mutate of [
    (f) => {
      f.input.activationEvidence.cloudflare.plan = "paid";
    },
    (f) => {
      f.input.activationEvidence.cloudflare.collectedAt =
        "2020-01-01T00:00:00Z";
    },
    (f) => {
      f.input.activationEvidence.releaseSha = "f".repeat(40);
    },
    (f) => {
      f.input.ownership.legacySchedulersStopped = false;
    },
    (f) => {
      f.input.ownership.releaseSha = "f".repeat(40);
    },
  ]) {
    const f = fixture();
    try {
      activation(f);
      mutate(f);
      await assert.rejects(transitionApiConsumers({ ...f.input, apply: true }));
      assert.deepEqual(f.calls, []);
    } finally {
      f.close();
    }
  }
});

test("private activation breaks the paused-alarm bootstrap cycle without passing the public release gate", async () => {
  const f = fixture();
  try {
    activation(f);
    f.input.activationEvidence.durable.journeysPassed = false;
    f.input.activationEvidence.durable.measurements = {};
    f.input.activationEvidence.durable.rollback.readbackPassed = false;
    assert.equal(assessWebRelease(f.input.activationEvidence).selected, null);
    const result = await transitionApiConsumers({ ...f.input, apply: true });
    assert.equal(result.status, "verified-active");
    assert.equal(result.productionEligible, false);
    assert.ok(result.transition.isolationDigest);
    assert.equal(assessWebRelease(f.input.activationEvidence).selected, null);
    assert.notEqual(
      result.runtimeReleases.discovery.workerVersionId,
      f.input.manifest.runtimeReleases.discovery.workerVersionId,
    );
  } finally {
    f.close();
  }
});

test("private activation refuses absent or public isolation readbacks", async () => {
  for (const verifyPrivateRuntime of [
    undefined,
    async () => ({ private: false, accountId, releaseSha: sha }),
    async () => ({ private: true, accountId: "f".repeat(32), releaseSha: sha }),
  ]) {
    const f = fixture();
    try {
      activation(f);
      await assert.rejects(
        transitionApiConsumers({
          ...f.input,
          apply: true,
          verifyPrivateRuntime,
        }),
        /isolation|private/i,
      );
      assert.deepEqual(f.calls, []);
    } finally {
      f.close();
    }
  }
});

test("pause can replace an active pair while retaining active versions for explicit recovery", async () => {
  const f = fixture();
  try {
    f.input.manifest.status = "verified-active";
    for (const role of ["api", "discovery"]) {
      const file = join(
        f.input.artifacts[role].directory,
        ".cloudflare/output/v0/workers/default/worker.config.json",
      );
      const config = JSON.parse(readFileSync(file));
      config.env.ATLAS_ACTIVE_RELEASE_SHA.value = sha;
      writeFileSync(file, JSON.stringify(config));
      const digest = digestDirectory(
        join(f.input.artifacts[role].directory, ".cloudflare/output/v0"),
      );
      f.input.artifacts[role].artifactDigest = digest;
      f.input.manifest.runtimeReleases[role].artifactDigest = digest;
      f.messages[role] = consumerReleaseMessage(
        f.input.manifest,
        role,
        digest,
        "activate",
      );
    }
    const result = await transitionApiConsumers({ ...f.input, apply: true });
    assert.equal(result.status, "verified-paused");
    assert.deepEqual(f.calls, ["discovery", "api"]);
    assert.match(f.messages.api, /consumers paused$/);
  } finally {
    f.close();
  }
});

test("a probe from another release or an undrained consumer cannot certify pause", async () => {
  for (const body of [
    { releaseSha: "f".repeat(40), activeReleaseSha: "", enabled: false },
    { releaseSha: sha, activeReleaseSha: sha, enabled: true },
  ]) {
    const f = fixture();
    try {
      const original = f.input.probe;
      await assert.rejects(
        transitionApiConsumers({
          ...f.input,
          apply: true,
          probe: async (request) =>
            request.path === "/__atlas/consumers"
              ? { status: 200, body }
              : original(request),
        }),
        /reconciliation/,
      );
      assert.equal(f.journals.at(-1).manifest.status, "verification-required");
    } finally {
      f.close();
    }
  }
});

test("a concurrent release during the intent checkpoint is not overwritten", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      transitionApiConsumers({
        ...f.input,
        apply: true,
        checkpoint: async (journal) => {
          f.journals.push(structuredClone(journal));
          if (journal.phase === "deploying-discovery")
            f.versions.api = "ffffffff-ffff-ffff-ffff-ffffffffffff";
        },
      }),
      /readback/,
    );
    assert.deepEqual(f.calls, []);
  } finally {
    f.close();
  }
});

test("accepted upload followed by a CLI error retains the actual recoverable version", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      transitionApiConsumers({
        ...f.input,
        apply: true,
        deploy: async (artifact, options) => {
          await f.input.deploy(artifact, options);
          throw Error("CLI stream failed after upload");
        },
      }),
    );
    const saved = f.journals.at(-1).manifest;
    assert.equal(
      saved.runtimeReleases.discovery.workerVersionId,
      f.versions.discovery,
    );
    assert.equal(
      saved.rollbackPlan.current.discovery.workerVersionId,
      f.versions.discovery,
    );
    assert.equal(saved.uncertainDeployment, undefined);
    assert.equal(saved.status, "verification-required");
  } finally {
    f.close();
  }
});

test("unavailable readback after an accepted write records uncertainty without inventing rollback identity", async () => {
  const f = fixture();
  let uploaded = false;
  try {
    await assert.rejects(
      transitionApiConsumers({
        ...f.input,
        apply: true,
        cloudflare: (command) => {
          if (uploaded) throw Error("provider unavailable");
          return f.input.cloudflare(command);
        },
        deploy: async (artifact, options) => {
          await f.input.deploy(artifact, options);
          uploaded = true;
          throw Error("upload ambiguous");
        },
      }),
    );
    const saved = f.journals.at(-1).manifest;
    assert.equal(saved.uncertainDeployment.role, "discovery");
    assert.ok(saved.uncertainDeployment.artifactDigest);
    assert.equal(
      saved.runtimeReleases.discovery.workerVersionId,
      saved.previousSnapshot.runtimeReleases.discovery.workerVersionId,
    );
    assert.equal(saved.status, "verification-required");
    const reconciled = await reconcileConsumerJournal({
      journal: f.journals.at(-1),
      env: f.input.env,
      cloudflare: f.input.cloudflare,
      checkpoint: async (j) => f.journals.push(j),
    });
    assert.equal(reconciled.status, "verification-required");
    assert.equal(
      reconciled.runtimeReleases.discovery.workerVersionId,
      f.versions.discovery,
    );
    assert.equal(
      reconciled.rollbackPlan.current.discovery.workerVersionId,
      f.versions.discovery,
    );
    assert.equal(reconciled.uncertainDeployment, undefined);
    assert.equal(f.journals.at(-1).phase, "reconciled-for-rollback");
    assert.deepEqual(f.calls, ["discovery"]);
  } finally {
    f.close();
  }
});

test("an unrelated version after upload is never assigned the intended artifact or rolled back blindly", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      transitionApiConsumers({
        ...f.input,
        apply: true,
        deploy: async (artifact, options) => {
          await f.input.deploy(artifact, options);
          f.messages.discovery = "another release";
        },
      }),
      /annotations/,
    );
    const journal = f.journals.at(-1);
    assert.equal(journal.manifest.uncertainDeployment.role, "discovery");
    assert.equal(
      journal.manifest.runtimeReleases.discovery.workerVersionId,
      journal.manifest.previousSnapshot.runtimeReleases.discovery
        .workerVersionId,
    );
    await assert.rejects(
      reconcileConsumerJournal({
        journal,
        env: f.input.env,
        cloudflare: f.input.cloudflare,
        checkpoint: async () => {},
      }),
      /annotations/,
    );
  } finally {
    f.close();
  }
});

test("a durable pre-write intent can recover an accepted upload after process death without catch", async () => {
  const f = fixture();
  try {
    await transitionApiConsumers({ ...f.input, apply: true });
    const interrupted = f.journals.find((j) => j.phase === "deploying-api");
    assert.equal(interrupted.manifest.status, "planned");
    assert.equal(interrupted.manifest.uncertainDeployment.role, "api");
    const recovered = await reconcileConsumerJournal({
      journal: interrupted,
      env: f.input.env,
      cloudflare: f.input.cloudflare,
      checkpoint: async (j) => f.journals.push(j),
    });
    assert.equal(recovered.status, "verification-required");
    assert.equal(
      recovered.rollbackPlan.current.api.workerVersionId,
      f.versions.api,
    );
    assert.equal(
      recovered.rollbackPlan.current.discovery.workerVersionId,
      f.versions.discovery,
    );
    assert.equal(recovered.uncertainDeployment, undefined);
    assert.deepEqual(f.calls, ["discovery", "api"]);
  } finally {
    f.close();
  }
});

test("namespace drift during upload remains uncertain and cannot become a recoverable intended identity", async () => {
  const f = fixture();
  let uploaded = false;
  try {
    await assert.rejects(
      transitionApiConsumers({
        ...f.input,
        apply: true,
        deploy: async (artifact, options) => {
          await f.input.deploy(artifact, options);
          uploaded = true;
        },
        cloudflare: (command) => {
          const response = f.input.cloudflare(command);
          return uploaded && command[0] === "durable-objects"
            ? response.map((row) => ({ ...row, id: "f".repeat(32) }))
            : response;
        },
      }),
      /namespace|readback/,
    );
    const manifest = f.journals.at(-1).manifest;
    assert.equal(manifest.uncertainDeployment.role, "discovery");
    assert.equal(
      manifest.runtimeReleases.discovery.workerVersionId,
      manifest.previousSnapshot.runtimeReleases.discovery.workerVersionId,
    );
    assert.equal(
      manifest.rollbackPlan.current.discovery.workerVersionId,
      manifest.previousSnapshot.runtimeReleases.discovery.workerVersionId,
    );
  } finally {
    f.close();
  }
});
