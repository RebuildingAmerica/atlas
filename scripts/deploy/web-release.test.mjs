import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWebManifest,
  verifyWebManifest,
  assertPromotionReady,
  copyWebArtifact,
  digestDirectory,
} from "./web-release.mjs";
const sha = "a".repeat(40);
const digest = "b".repeat(64);
const manifest = () =>
  createWebManifest({
    target: "staging",
    architecture: "workers",
    releaseSha: sha,
    artifactDigest: digest,
    assetsDigest: digest,
    sourceDirty: false,
  });

test("release metadata is fixed, contains no credentials, and pins source and assets", () => {
  const output = createWebManifest({
    ...manifest(),
    DATABASE_URL: "private",
    ATLAS_WEB_ORIGIN_SECRET: "private",
  });
  assert.equal(JSON.stringify(output).includes("private"), false);
  assert.equal(output.workerName, "atlas-workers-staging-" + sha.slice(0, 12));
  assert.equal(
    verifyWebManifest(output, {
      releaseSha: sha,
      artifactDigest: digest,
      assetsDigest: digest,
    }),
    true,
  );
});
test("rejects dirty sources, wrong commit, modified bundles, and incomplete hybrid identity", () => {
  for (const patch of [
    { sourceDirty: true },
    { releaseSha: "c".repeat(40) },
    { assetsDigest: "c".repeat(64) },
    { architecture: "hybrid" },
  ]) {
    assert.throws(() =>
      verifyWebManifest(
        { ...manifest(), ...patch },
        { releaseSha: sha, artifactDigest: digest, assetsDigest: digest },
      ),
    );
  }
});
test("production promotion cannot substitute missing observation or baseline evidence", () => {
  assert.throws(() => assertPromotionReady({}, manifest(), Date.now()));
});

test("portable artifacts materialize nested internal links and reject escapes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-artifact-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  mkdirSync(join(source, "node_modules", ".traced", "tslib"), {
    recursive: true,
  });
  writeFileSync(
    join(source, "node_modules", ".traced", "tslib", "index.js"),
    "export const value=1;",
  );
  symlinkSync(".traced/tslib", join(source, "node_modules", "tslib"));
  const target = join(root, "target");
  copyWebArtifact(source, target);
  assert.equal(
    lstatSync(join(target, "node_modules", "tslib")).isDirectory(),
    true,
  );
  assert.match(digestDirectory(target), /^[a-f0-9]{64}$/);
  writeFileSync(join(root, "private"), "not an artifact");
  symlinkSync(join(root, "private"), join(source, "escape"));
  assert.throws(
    () => copyWebArtifact(source, join(root, "rejected")),
    /escapes/,
  );
});

test("promotion accepts only a fresh exact release after a complete staging window", () => {
  const now = Date.now();
  const costs = {
    cpuSeconds: 0,
    gibSeconds: 0,
    requests: 0,
    egressGiB: 0,
    storageUsd: 0,
    buildsUsd: 0,
    logsUsd: 0,
    databaseUsd: 0,
  };
  const evidence = {
    releaseSha: sha,
    baseline: {
      days: 14,
      windowEnd: new Date(now - 3600000).toISOString(),
      warmP95Ms: 200,
      peakDynamicRequestsPerDay: 100,
    },
    cloudflare: { plan: "free", otherRequestsPerDay: 0, otherQueriesPerDay: 0 },
    workers: {
      journeysPassed: true,
      limitsPassed: true,
      cpuP99Ms: 7,
      cpuLimitFailures: 0,
      queriesPerDay: 200,
      warmP95Ms: 210,
      coldP95Ms: 1000,
      addedMonthlyCosts: {
        databaseUsd: 0,
        networkUsd: 0,
        buildsUsd: 0,
        storageUsd: 0,
        logsUsd: 0,
      },
    },
    hybrid: {
      journeysPassed: true,
      originProtected: true,
      warmP95Ms: 210,
      coldP95Ms: 1000,
      monthly: costs,
      freeRemaining: {
        cpuSeconds: 0,
        gibSeconds: 0,
        requests: 0,
        egressGiB: 0,
      },
      rates: {
        cpuSecondUsd: 0,
        gibSecondUsd: 0,
        millionRequestsUsd: 0,
        egressGiBUsd: 0,
      },
    },
    staging: {
      startedAt: new Date(now - 25 * 3600000).toISOString(),
      lastCheckedAt: new Date(now).toISOString(),
      continuousChecksPassed: true,
    },
  };
  assert.equal(
    assertPromotionReady(evidence, manifest(), now).selected,
    "workers",
  );
  for (const patch of [
    { releaseSha: "f".repeat(40) },
    {
      baseline: {
        ...evidence.baseline,
        windowEnd: new Date(now - 49 * 3600000).toISOString(),
      },
    },
    {
      staging: {
        ...evidence.staging,
        startedAt: new Date(now - 23 * 3600000).toISOString(),
      },
    },
    {
      staging: {
        ...evidence.staging,
        lastCheckedAt: new Date(now - 11 * 60000).toISOString(),
      },
    },
    { staging: { ...evidence.staging, continuousChecksPassed: false } },
  ])
    assert.throws(() =>
      assertPromotionReady({ ...evidence, ...patch }, manifest(), now),
    );
});
