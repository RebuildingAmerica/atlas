import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  validateEvaluationDestination,
  validateEvaluationDatabase,
  evaluate,
} from "./web-durable-evaluation.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
