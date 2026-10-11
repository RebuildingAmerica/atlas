import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestDirectory } from "./web-release.mjs";
import { captureApiRuntimeSnapshot } from "./api-runtime-rollback.mjs";
import {
  publishApiRelease,
  canonicalDigest,
  releaseMessage,
  prepareOperationsOutput,
  deployReleaseArtifact,
  verifyPausedApiRelease,
} from "./api-cloudflare-release.mjs";

const sha = "a".repeat(40),
  accountId = "b".repeat(32),
  schemaReceiptDigest = "c".repeat(64);
const versions = {
  api: "11111111-1111-1111-1111-111111111111",
  discovery: "22222222-2222-2222-2222-222222222222",
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "atlas-api-release-")),
    calls = [],
    journals = [],
    state = {};
  const schema = {
    schemaVersion: 1,
    kind: "atlas-postgres-schema-release",
    releaseSha: sha,
    schemaDigest: "d".repeat(64),
    migrationSourcesDigest: "e".repeat(64),
    databaseIdentityDigest: "f".repeat(64),
    catalogDigest: "0".repeat(64),
    completedAt: "2026-10-11T00:00:00Z",
  };
  const schemaResult = {
    status: "ready",
    receipt: schema,
    receiptDigest: canonicalDigest(schema),
  };
  const artifacts = Object.fromEntries(
    ["api", "discovery"].map((role) => {
      const directory = join(root, role),
        out = join(directory, ".cloudflare/output/v0"),
        base = join(out, "workers/default");
      mkdirSync(base, { recursive: true });
      writeFileSync(join(out, "config.json"), JSON.stringify({ accountId }));
      const config = {
        name: `atlas-${role}-staging`,
        workersDev: false,
        previewUrls: false,
        manifest: {
          mainModule:
            role === "api" ? "production_entry.py" : "production_discovery.py",
        },
        exports: {
          [role === "api" ? "ApiRuntime" : "DiscoveryRuntime"]: {
            type: "durable-object",
            storage: "sqlite",
          },
        },
        env: {
          ATLAS_API_SETTINGS: { type: "secret" },
          HYPERDRIVE: { type: "hyperdrive", id: "7".repeat(32) },
          API_RUNTIME: {
            type: "durable-object",
            worker: "atlas-api-staging",
            exportName: "ApiRuntime",
          },
          DISCOVERY_RUNTIME: {
            type: "durable-object",
            worker: "atlas-discovery-staging",
            exportName: "DiscoveryRuntime",
          },
          ATLAS_RELEASE_SHA: { type: "text", value: sha },
          ATLAS_SCHEMA_RECEIPT_DIGEST: {
            type: "text",
            value: schemaResult.receiptDigest,
          },
        },
      };
      writeFileSync(join(base, "worker.config.json"), JSON.stringify(config));
      return [role, { directory, artifactDigest: digestDirectory(out) }];
    }),
  );
  const bootstrapArtifact = { directory: join(root, "seed") };
  mkdirSync(
    join(bootstrapArtifact.directory, ".cloudflare/output/v0/workers/default"),
    { recursive: true },
  );
  for (const file of ["config.json", "workers/default/worker.config.json"])
    writeFileSync(
      join(bootstrapArtifact.directory, ".cloudflare/output/v0", file),
      readFileSync(
        join(artifacts.api.directory, ".cloudflare/output/v0", file),
      ),
    );
  const seedConfig = JSON.parse(
    readFileSync(
      join(
        bootstrapArtifact.directory,
        ".cloudflare/output/v0/workers/default/worker.config.json",
      ),
    ),
  );
  delete seedConfig.env.DISCOVERY_RUNTIME;
  writeFileSync(
    join(
      bootstrapArtifact.directory,
      ".cloudflare/output/v0/workers/default/worker.config.json",
    ),
    JSON.stringify(seedConfig),
  );
  bootstrapArtifact.artifactDigest = digestDirectory(
    join(bootstrapArtifact.directory, ".cloudflare/output/v0"),
  );
  const messages = {};
  const env = {
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: "never-print-bearer",
  };
  const cloudflare = (cmd) => {
    calls.push(cmd);
    if (cmd[0] === "accounts") return [{ rate_plan: { id: "workers_free" } }];
    if (cmd.join(" ") === "workers list") return [];
    if (cmd[0] === "durable-objects")
      return Object.keys(state).map((role) => ({
        id: (role === "api" ? "1" : "2").repeat(32),
        script: `atlas-${role}-staging`,
        class: role === "api" ? "ApiRuntime" : "DiscoveryRuntime",
        use_sqlite: true,
      }));
    const role = cmd.at(-1).includes("discovery") ? "discovery" : "api";
    if (cmd[1] === "deployments")
      return {
        deployments: [
          { versions: [{ version_id: state[role], percentage: 100 }] },
        ],
      };
    if (cmd[1] === "versions")
      return {
        id: state[role],
        annotations: { "workers/tag": sha, "workers/message": messages[role] },
      };
    throw Error("Unexpected provider call");
  };
  const probe = async ({ role, path, releaseSha }) => {
    if (path === "/__atlas/release")
      return {
        status: 200,
        body: {
          releaseSha,
          runtimeRole: role,
          schemaReceiptDigest: schemaResult.receiptDigest,
        },
      };
    if (path === "/__atlas/consumers")
      return { status: 200, body: { releaseSha, enabled: false } };
    return { status: 200, body: { status: "ok" } };
  };
  const input = {
    target: "staging",
    releaseSha: sha,
    accountId,
    env,
    schemaResult,
    provenance: {
      nativeRunId: "123",
      nativeBuildSha: sha,
      nativeProvenanceDigest: "3".repeat(64),
      packageProvenanceDigest: "4".repeat(64),
      coreSha256: "5".repeat(64),
      packagesSha256: "6".repeat(64),
    },
    artifacts,
    bootstrapArtifact,
    cloudflare,
    probe,
    checkpoint: async (j) => journals.push(structuredClone(j)),
    deploy: async (role, artifact, identity) => {
      state[role] = identity.bootstrap
        ? "33333333-3333-3333-3333-333333333333"
        : versions[role];
      messages[role] = identity.message;
    },
    bootstrap: true,
    now: () => Date.parse("2026-10-11T01:00:00Z"),
  };
  return { root, input, state, calls, journals };
}
async function using(fn) {
  const f = fixture();
  try {
    await fn(f);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}

test("dry run validates exact artifacts/schema and performs no provider writes", () =>
  using(async (f) => {
    const r = await publishApiRelease(f.input);
    assert.equal(r.status, "planned");
    assert.deepEqual(f.state, {});
    assert.equal(f.journals.length, 0);
  }));
test("bootstrap records exact joint readbacks and real paused probes without activation", () =>
  using(async (f) => {
    const r = await publishApiRelease({ ...f.input, apply: true });
    assert.equal(r.status, "verified-paused");
    assert.equal(r.productionEligible, false);
    assert.equal(r.runtimeReleases.api.workerVersionId, versions.api);
    assert.equal(
      r.retainedSnapshot.runtimeReleases.discovery.workerVersionId,
      versions.discovery,
    );
    assert.equal(r.rollbackPlan, null);
    assert.equal(r.checks.length, 6);
    assert.ok(f.journals.some((j) => j.phase === "deploying-api"));
    assert.ok(f.journals.at(-1).manifest.runtimeReleases.api.artifactDigest);
    assert.ok(!JSON.stringify(r).includes(f.input.env.CLOUDFLARE_API_TOKEN));
  }));
test("schema tampering, artifact tampering, missing session and paid plan fail before deployment", () =>
  using(async (f) => {
    for (const patch of [
      {
        schemaResult: {
          ...f.input.schemaResult,
          receiptDigest: schemaReceiptDigest,
        },
      },
      { env: { CLOUDFLARE_ACCOUNT_ID: accountId } },
      { cloudflare: () => [{ rate_plan: { id: "workers_paid" } }] },
    ])
      await assert.rejects(
        publishApiRelease({ ...f.input, ...patch, apply: true }),
      );
    writeFileSync(
      join(f.input.artifacts.api.directory, ".cloudflare/output/v0/tamper"),
      "changed",
    );
    await assert.rejects(
      publishApiRelease({ ...f.input, apply: true }),
      /artifact/,
    );
    assert.deepEqual(f.state, {});
  }));
test("provider tag or SQLite identity mismatch is retained as failed verification", () =>
  using(async (f) => {
    const cf = f.input.cloudflare;
    await assert.rejects(
      publishApiRelease({
        ...f.input,
        apply: true,
        cloudflare: (cmd) =>
          cmd[1] === "versions"
            ? {
                id: versions.discovery,
                annotations: { "workers/tag": "0".repeat(40) },
              }
            : cf(cmd),
      }),
      /readback/,
    );
    assert.equal(f.journals.at(-1).phase, "verification-required");
    assert.equal(f.journals.at(-1).manifest.productionEligible, false);
  }));
test("enabled consumer or failed real probe cannot become verified", () =>
  using(async (f) => {
    const probe = f.input.probe;
    await assert.rejects(
      publishApiRelease({
        ...f.input,
        apply: true,
        probe: async (q) =>
          q.path === "/__atlas/consumers"
            ? { status: 200, body: { releaseSha: sha, enabled: true } }
            : probe(q),
      }),
      /paused/,
    );
    assert.equal(f.journals.at(-1).phase, "verification-required");
  }));
test("retained release captures rollback before replacement and rejects enabled consumers", () =>
  using(async (f) => {
    await publishApiRelease({ ...f.input, apply: true });
    const identities = await publishApiRelease({
      ...f.input,
      apply: true,
      bootstrap: false,
      previous: {
        target: "staging",
        accountId,
        schemaReceiptDigest: f.input.schemaResult.receiptDigest,
        runtimeReleases: Object.fromEntries(
          ["api", "discovery"].map((role) => [
            role,
            {
              workerName: `atlas-${role}-staging`,
              releaseSha: sha,
              artifactDigest: f.input.artifacts[role].artifactDigest,
              workerVersionId: versions[role],
              namespaceId: (role === "api" ? "1" : "2").repeat(32),
              namespaceClass:
                role === "api" ? "ApiRuntime" : "DiscoveryRuntime",
              storage: "sqlite",
            },
          ]),
        ),
      },
    });
    assert.ok(identities.rollbackPlan.planId);
    assert.ok(f.journals.some((j) => j.previousSnapshot?.snapshotId));
  }));
test("operations edge requires existing Access-protected hostname and rejects all writes", async () => {
  const f = fixture();
  try {
    const r = await prepareOperationsOutput({
      destination: join(f.root, "ops"),
      accountId,
      target: "staging",
      hostname: "atlas-api-ops-staging.atlas.example.org",
    });
    const mod = await import(
      "data:text/javascript," + encodeURIComponent(r.code)
    );
    let forwarded = 0;
    const env = {
      API_RUNTIME: {
        getByName: (name, options) => {
          assert.equal(name, "application");
          assert.deepEqual(options, { locationHint: "enam" });
          return {
            fetch: () => {
              forwarded++;
              return new Response("ok");
            },
          };
        },
      },
      DISCOVERY_RUNTIME: {
        getByName: () => ({ fetch: () => new Response("discovery") }),
      },
    };
    assert.equal(
      (await mod.default.fetch(new Request("https://ops/api/health"), env))
        .status,
      200,
    );
    assert.equal(
      (
        await mod.default.fetch(
          new Request("https://ops/api/__atlas/consumers", { method: "POST" }),
          env,
        )
      ).status,
      405,
    );
    assert.equal(
      (await mod.default.fetch(new Request("https://ops/discovery/jobs"), env))
        .status,
      404,
    );
    assert.equal(forwarded, 1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("replacement refuses active consumers before any deployment or checkpoint", () =>
  using(async (f) => {
    const old = await publishApiRelease({ ...f.input, apply: true });
    f.journals.length = 0;
    let writes = 0;
    await assert.rejects(
      publishApiRelease({
        ...f.input,
        previous: old,
        bootstrap: false,
        apply: true,
        deploy: async () => {
          writes++;
        },
        probe: async (q) =>
          q.path === "/__atlas/consumers"
            ? { status: 200, body: { releaseSha: sha, enabled: true } }
            : f.input.probe(q),
      }),
      /paused/,
    );
    assert.equal(writes, 0);
    assert.equal(f.journals.length, 0);
  }));
test("bootstrap cannot overwrite existing Worker names", () =>
  using(async (f) => {
    const cf = f.input.cloudflare;
    await assert.rejects(
      publishApiRelease({
        ...f.input,
        apply: true,
        cloudflare: (cmd) =>
          cmd.join(" ") === "workers list"
            ? [{ name: "atlas-api-staging" }]
            : cf(cmd),
      }),
      /absent/,
    );
    assert.deepEqual(f.state, {});
  }));
test("cf deployment receives bearer only via env and removes private settings on failures", () =>
  using(async (f) => {
    let privateFile;
    const runner = (binary, args, options) => {
      assert.equal(binary, "pnpm");
      assert.deepEqual(args.slice(0, 3), ["exec", "cf", "deploy"]);
      assert.ok(!args.includes("--profile"));
      assert.ok(
        !args.some(
          (a) =>
            a.includes("secret-value") ||
            a.includes(f.input.env.CLOUDFLARE_API_TOKEN),
        ),
      );
      assert.equal(options.env, f.input.env);
      privateFile = args[args.indexOf("--secrets-file") + 1];
      assert.equal(
        JSON.parse(readFileSync(privateFile, "utf8")).ATLAS_API_SETTINGS,
        JSON.stringify({ secret: "secret-value" }),
      );
      return {
        status: 1,
        stderr: "secret-value " + f.input.env.CLOUDFLARE_API_TOKEN,
      };
    };
    assert.throws(
      () =>
        deployReleaseArtifact(f.input.artifacts.api, {
          message: "reviewed release",
          releaseSha: sha,
          settings: { secret: "secret-value" },
          env: f.input.env,
          runner,
        }),
      /private diagnostics were suppressed/,
    );
    assert.throws(() => readFileSync(privateFile), /ENOENT/);
    assert.throws(
      () =>
        deployReleaseArtifact(f.input.artifacts.api, {
          env: f.input.env,
          runner: () => {
            throw Error("secret-value");
          },
        }),
      (e) => !e.message.includes("secret-value"),
    );
  }));

test("verification-only resumes exact published versions without a deployment callback", () =>
  using(async (f) => {
    const published = await publishApiRelease({ ...f.input, apply: true });
    const before = structuredClone(f.state);
    const resumed = await verifyPausedApiRelease({
      manifest: { ...published, status: "verification-required" },
      env: f.input.env,
      cloudflare: f.input.cloudflare,
      probe: f.input.probe,
      checkpoint: async (j) => f.journals.push(j),
    });
    assert.equal(resumed.status, "verified-paused");
    assert.deepEqual(f.state, before);
    await assert.rejects(
      verifyPausedApiRelease({
        manifest: {
          ...published,
          runtimeReleases: {
            ...published.runtimeReleases,
            api: {
              ...published.runtimeReleases.api,
              artifactDigest: "9".repeat(64),
            },
          },
        },
        env: f.input.env,
        cloudflare: f.input.cloudflare,
        probe: f.input.probe,
        checkpoint: async () => {},
      }),
      /readback/,
    );
  }));

test("concurrent provider replacement after preflight stops before an upload", () =>
  using(async (f) => {
    const retained = await publishApiRelease({ ...f.input, apply: true });
    let writes = 0;
    await assert.rejects(
      publishApiRelease({
        ...f.input,
        previous: retained,
        bootstrap: false,
        apply: true,
        deploy: async () => {
          writes++;
        },
        checkpoint: async (j) => {
          if (j.phase === "prepared")
            f.state.api = "99999999-9999-9999-9999-999999999999";
        },
      }),
      /readback/,
    );
    assert.equal(writes, 0);
  }));
