import assert from "node:assert/strict";
import { test } from "node:test";
import { assessWebRelease, validateReleasePolicy } from "./web-assess.mjs";

const now = Date.parse("2026-10-10T20:00:00Z");
const sha = "a".repeat(40);
function evidence() {
  const runtime = (workerName) => ({
    workerName,
    releaseSha: sha,
    workerVersionId: "12345678-1234-1234-1234-123456789abc",
    artifactDigest: "b".repeat(64),
    namespaceId: "c".repeat(32),
    namespaceClass: "Runtime",
    storage: "sqlite",
  });
  const measured = (identity) => ({
    ...identity,
    provider: "cloudflare",
    evidenceReference: "private/provider-export.json",
    collectedAt: new Date(now).toISOString(),
    cpuP99Ms: 30,
    peakMemoryBytes: 80_000_000,
    memoryMeasurement: "provider",
    knownMemoryLimitBytes: 128 * 1024 * 1024,
    memoryLimitFailures: 0,
    providerLoad: {
      representativePassed: true,
      maxBoundedPayloadPassed: true,
      concurrencyPassed: true,
      scopeReference: "private/load-scope.json",
    },
    peakConnections: 2,
    limitFailures: 0,
    bundleStartupPassed: true,
    maxAlarmWallMs: 1000,
    resumableAlarmsPassed: true,
  });
  const runtimeReleases = {
    web: runtime("atlas-web"),
    api: runtime("atlas-api"),
    discovery: runtime("atlas-api"),
  };
  return {
    releaseSha: sha,
    releasePolicy: {
      mode: "immediate",
      architecture: "cloudflare-durable",
      releaseSha: sha,
      authorizedBy: "Operator",
      authorizationReference:
        "Operator instruction: waive staging and observation waits",
      authorizedAt: new Date(now - 1000).toISOString(),
    },
    baseline: {
      days: 14,
      warmP95Ms: 200,
      windowEnd: new Date(now).toISOString(),
    },
    cloudflare: {
      accountId: "d".repeat(32),
      plan: "free",
      collectedAt: new Date(now).toISOString(),
      evidenceReference: "private/account-usage.json",
      quotas: Object.fromEntries(
        [
          "workersRequestsPerDay",
          "durableRequestsPerDay",
          "durableGbSecondsPerDay",
          "durableRowsReadPerDay",
          "durableRowsWrittenPerDay",
          "durableStorageBytes",
          "hyperdriveQueriesPerDay",
        ].map((key) => [key, { candidate: 1, otherAccountUsage: 1 }]),
      ),
    },
    durable: {
      journeysPassed: true,
      warmP95Ms: 210,
      coldP95Ms: 1000,
      addedMonthlyCosts: {
        databaseUsd: 0,
        networkUsd: 0,
        buildsUsd: 0,
        storageUsd: 0,
        logsUsd: 0,
      },
      runtimeReleases,
      measurements: Object.fromEntries(
        Object.entries(runtimeReleases).map(([key, identity]) => [
          key,
          measured(identity),
        ]),
      ),
      edgeCpuP99Ms: 1,
      edgeCpuLimitFailures: 0,
      rollback: {
        readbackPassed: true,
        evidenceReference: "private/rollback-readback.json",
        runtimeReleases,
      },
    },
  };
}

test("explicit immediate policy selects measured Cloudflare DO releases without Google forecasts", () => {
  const input = evidence();
  const result = assessWebRelease(input, now);
  assert.equal(result.selected, "workers");
  assert.deepEqual(result.releasePolicy, input.releasePolicy);
  assert.deepEqual(result.alternatives.workers.blockers, []);
  assert.equal(result.alternatives.hybrid, undefined);
});

test("immediate authorization records the real release and cannot become a generic bypass", () => {
  for (const patch of [
    { authorizedBy: "" },
    { authorizationReference: "" },
    { authorizedAt: new Date(now + 1).toISOString() },
    { architecture: "hybrid" },
    { releaseSha: "b".repeat(40) },
    { mode: "skip" },
  ]) {
    const input = evidence();
    Object.assign(input.releasePolicy, patch);
    assert.throws(() => validateReleasePolicy(input.releasePolicy, sha, now));
    assert.equal(assessWebRelease(input, now).selected, null);
  }
});

test("immediate release retains journeys, latency, measured provider memory, CPU, alarm and rollback gates", () => {
  for (const mutate of [
    (x) => {
      x.durable.journeysPassed = false;
    },
    (x) => {
      x.durable.warmP95Ms = 241;
    },
    (x) => {
      x.durable.coldP95Ms = 3001;
    },
    (x) => {
      x.durable.edgeCpuP99Ms = 9;
    },
    (x) => {
      x.durable.edgeCpuLimitFailures = 1;
    },
    (x) => {
      x.durable.measurements.api.cpuP99Ms = 30_000;
    },
    (x) => {
      x.durable.measurements.api.memoryMeasurement = "local-heap";
    },
    (x) => {
      x.durable.measurements.api.providerLoad.maxBoundedPayloadPassed = false;
    },
    (x) => {
      x.durable.measurements.api.memoryLimitFailures = 1;
    },
    (x) => {
      x.durable.measurements.api.peakMemoryBytes = 128 * 1024 * 1024;
    },
    (x) => {
      x.durable.measurements.discovery.maxAlarmWallMs = 900_000;
    },
    (x) => {
      x.durable.measurements.discovery.resumableAlarmsPassed = false;
    },
    (x) => {
      x.durable.measurements.web.limitFailures = 1;
    },
    (x) => {
      x.durable.measurements.web.bundleStartupPassed = false;
    },
    (x) => {
      x.durable.measurements.web.peakConnections = 7;
    },
    (x) => {
      x.durable.measurements.api.workerVersionId =
        "ffffffff-ffff-ffff-ffff-ffffffffffff";
    },
    (x) => {
      x.durable.runtimeReleases.discovery.storage = "kv";
    },
    (x) => {
      delete x.durable.runtimeReleases.api;
    },
    (x) => {
      x.durable.rollback.readbackPassed = false;
    },
    (x) => {
      x.durable.rollback.runtimeReleases = {};
    },
    (x) => {
      x.durable.addedMonthlyCosts.databaseUsd = 0.01;
    },
    (x) => {
      x.cloudflare.plan = "paid";
    },
    (x) => {
      x.cloudflare.collectedAt = new Date(now - 49 * 3600_000).toISOString();
    },
    (x) => {
      x.baseline.days = 13;
    },
  ]) {
    const input = evidence();
    mutate(input);
    const result = assessWebRelease(input, now);
    assert.equal(result.selected, null);
    assert.ok(result.blockers.length);
  }
});

test("provider load outcomes establish memory-limit acceptance when Cloudflare exposes no peak metric", () => {
  const input = evidence();
  for (const measured of Object.values(input.durable.measurements)) {
    delete measured.peakMemoryBytes;
    delete measured.memoryMeasurement;
  }
  assert.equal(assessWebRelease(input, now).selected, "workers");
});

test("every shared Free allowance keeps doubled candidate usage below 80 percent", () => {
  for (const key of Object.keys(evidence().cloudflare.quotas)) {
    for (const value of [undefined, -1, NaN, Infinity, 100_000_000_000]) {
      const input = evidence();
      input.cloudflare.quotas[key].candidate = value;
      assert.equal(assessWebRelease(input, now).selected, null, key);
    }
  }
});
