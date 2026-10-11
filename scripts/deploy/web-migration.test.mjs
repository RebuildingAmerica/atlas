import assert from "node:assert/strict";
import { test } from "node:test";
import { assessMigration, forecastMonthlyCost } from "./web-migration.mjs";

function evidence() {
  return {
    baseline: { days: 14, warmP95Ms: 200, peakDynamicRequestsPerDay: 1000 },
    cloudflare: {
      plan: "free",
      otherRequestsPerDay: 100,
      otherQueriesPerDay: 100,
    },
    workers: {
      addedMonthlyCosts: {
        databaseUsd: 0,
        networkUsd: 0,
        buildsUsd: 0,
        storageUsd: 0,
        logsUsd: 0,
      },
      journeysPassed: true,
      limitsPassed: true,
      cpuP99Ms: 7,
      cpuLimitFailures: 0,
      queriesPerDay: 1000,
      warmP95Ms: 210,
      coldP95Ms: 300,
    },
    hybrid: {
      journeysPassed: true,
      originProtected: true,
      warmP95Ms: 210,
      coldP95Ms: 2000,
      monthly: {
        cpuSeconds: 1000,
        gibSeconds: 750,
        requests: 30000,
        egressGiB: 2,
        storageUsd: 0.1,
        buildsUsd: 0.1,
        logsUsd: 0.1,
        databaseUsd: 0.1,
      },
      freeRemaining: {
        cpuSeconds: 0,
        gibSeconds: 0,
        requests: 0,
        egressGiB: 0,
      },
      rates: {
        cpuSecondUsd: 0.000024,
        gibSecondUsd: 0.0000025,
        millionRequestsUsd: 0.4,
        egressGiBUsd: 0.12,
      },
    },
  };
}

test("missing evidence blocks both alternatives rather than assuming zero usage", () => {
  const result = assessMigration({});
  assert.equal(result.selected, null);
  assert.ok(result.blockers.length > 0);
});
test("prefers full Workers only when all gates pass", () => {
  assert.equal(assessMigration(evidence()).selected, "workers");
});
test("uses hybrid when Workers CPU fails and hybrid fits measured budget", () => {
  const input = evidence();
  input.workers.cpuP99Ms = 9;
  assert.equal(assessMigration(input).selected, "hybrid");
});
test("does not count shared free allowances twice and includes ancillary costs", () => {
  const input = evidence().hybrid;
  assert.ok(forecastMonthlyCost(input, 2) > 0.8);
  input.monthly.storageUsd = 6;
  const all = evidence();
  all.workers.cpuP99Ms = 9;
  all.hybrid = input;
  assert.equal(assessMigration(all).selected, null);
});
test("blocks incomplete, non-finite, negative, and stale-shaped observations", () => {
  for (const value of [undefined, -1, NaN, Infinity]) {
    const input = evidence();
    input.baseline.peakDynamicRequestsPerDay = value;
    assert.equal(assessMigration(input).selected, null);
  }
  const input = evidence();
  input.baseline.days = 13;
  assert.equal(assessMigration(input).selected, null);
});
test("shared daily quotas and paid Cloudflare cannot pass", () => {
  const input = evidence();
  input.cloudflare.otherRequestsPerDay = 79000;
  assert.equal(assessMigration(input).selected, null);
  input.cloudflare.plan = "paid";
  assert.equal(assessMigration(input).selected, null);
});
test("journeys, cold starts, origin security and CPU failures block selection", () => {
  for (const update of [
    (x) => {
      x.workers.journeysPassed = false;
      x.hybrid.journeysPassed = false;
    },
    (x) => {
      x.workers.cpuLimitFailures = 1;
      x.hybrid.originProtected = false;
    },
    (x) => {
      x.workers.warmP95Ms = 241;
      x.hybrid.coldP95Ms = 3001;
    },
  ]) {
    const input = evidence();
    update(input);
    assert.equal(assessMigration(input).selected, null);
  }
});

test("selection requires forecasts for both alternatives even when native journeys pass", () => {
  const input = evidence();
  delete input.hybrid.monthly;
  assert.equal(assessMigration(input).selected, null);
});
