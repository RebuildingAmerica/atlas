import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  validateEvaluationDestination,
  validateEvaluationDatabase,
  evaluate,
  verifyEvaluation,
  assertEvaluationVersion,
} from "./web-durable-evaluation.mjs";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("evaluation accepts only its isolated Worker and matching hostname", () => {
  const valid = {
    workerName: "atlas-durable-eval-cpu",
    hostname: "atlas-durable-eval-cpu.atlas.example.com",
    canonicalUrl: "https://atlas.example.com",
  };
  assert.doesNotThrow(() => validateEvaluationDestination(valid));
  for (const invalid of [
    { workerName: "atlas-production" },
    { hostname: "atlas.example.com" },
    { hostname: "atlas-durable-eval-cpu.example.com" },
    { canonicalUrl: "https://" + valid.hostname },
    { canonicalUrl: undefined },
    { hostname: "atlas-durable-eval-cpu.example.com/path" },
  ])
    assert.throws(() =>
      validateEvaluationDestination({ ...valid, ...invalid }),
    );
});

test("evaluation rejects other databases on the same PostgreSQL host and enabled query caching", () => {
  const valid = {
    caching: { disabled: true },
    origin: {
      host: "db.example.com",
      user: "atlas",
      database: "atlas",
      port: 5432,
    },
  };
  const url = "postgres://atlas:private@db.example.com/atlas";
  assert.doesNotThrow(() => validateEvaluationDatabase(valid, url));
  for (const origin of [
    { host: "other.example.com" },
    { user: "other" },
    { database: "other" },
    { port: 6432 },
  ])
    assert.throws(() =>
      validateEvaluationDatabase(
        { ...valid, origin: { ...valid.origin, ...origin } },
        url,
      ),
    );
  assert.throws(() =>
    validateEvaluationDatabase({ ...valid, caching: { disabled: false } }, url),
  );
});

test("evaluation requires a complete immutable deployment at 100%", () => {
  const version = {
    version_id: "2035a26e-4d5d-4e9b-89cf-541493a39bfa",
    percentage: 100,
  };
  assert.equal(
    assertEvaluationVersion({ deployments: [{ versions: [version] }] }),
    version.version_id,
  );
  for (const value of [
    {},
    { deployments: [] },
    { deployments: [{}] },
    { deployments: [{ versions: [] }] },
    { deployments: [{ versions: [version, version] }] },
    { deployments: [{ versions: [{ ...version, percentage: 50 }] }] },
    { deployments: [{ versions: [{ percentage: 100 }] }] },
  ])
    assert.throws(
      () => assertEvaluationVersion(value),
      /exactly one immutable version/,
    );
});

test("provider credentials in runtime are rejected before any provider operation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-durable-runtime-test-"));
  try {
    const file = join(directory, "runtime.json");
    writeFileSync(
      file,
      JSON.stringify({ CLOUDFLARE_API_TOKEN: "must-not-be-uploaded" }),
    );
    await assert.rejects(evaluate(["--runtime-file", file]), /unsupported key/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a DNS failure retains deployment identity and can be verified without another deploy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-durable-verification-"));
  try {
    const file = join(directory, "evaluation.json");
    const evidence = {
      hostname: "atlas-durable-eval-cpu.atlas.example.com",
      version: "immutable-version",
      productionEligible: false,
    };
    const access = {
      client_id: "private-client",
      client_secret: "private-secret",
    };
    await assert.rejects(
      verifyEvaluation(file, evidence, access, async () => {
        throw new Error("private provider error");
      }),
      /hosted verification is pending/,
    );
    assert.equal(JSON.parse(readFileSync(file)).verification, "pending");
    let requests = 0;
    const verified = await verifyEvaluation(
      file,
      JSON.parse(readFileSync(file)),
      access,
      async (url, options) => {
        requests++;
        if (url.endsWith("/api/auth/get-session")) {
          assert.equal(
            options.headers["CF-Access-Client-Secret"],
            access.client_secret,
          );
          return new Response("null", {
            headers: { "cache-control": "private, no-store" },
          });
        }
        assert.equal(options.headers, undefined);
        return new Response(null, { status: 403 });
      },
    );
    assert.equal(requests, 2);
    assert.equal(verified.version, evidence.version);
    assert.equal(verified.verification, "anonymous-session-and-access");
    assert.ok(!readFileSync(file, "utf8").includes(access.client_secret));
    assert.ok(!readFileSync(file, "utf8").includes("private provider error"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("normal release preparation refuses experimental execution before building", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/deploy/web-hosting.mjs",
      "prepare",
      "--target",
      "staging",
      "--architecture",
      "workers",
    ],
    {
      env: { ...process.env, ATLAS_WORKERS_EXECUTION: "durable-evaluation" },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Experimental execution cannot produce a promotable release/,
  );
});
