#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assessMigration, forecastWorkersCost } from "./web-migration.mjs";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const VERSION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const TEN_MINUTES = 600_000;
// Free allowances checked against the linked provider docs on 2026-10-10.
// https://developers.cloudflare.com/durable-objects/platform/pricing/
// https://developers.cloudflare.com/hyperdrive/platform/pricing/
// https://developers.cloudflare.com/workers/platform/limits/
const FREE_QUOTAS = {
  workersRequestsPerDay: 100_000,
  durableRequestsPerDay: 100_000,
  durableGbSecondsPerDay: 13_000,
  durableRowsReadPerDay: 5_000_000,
  durableRowsWrittenPerDay: 100_000,
  durableStorageBytes: 5_000_000_000,
  hyperdriveQueriesPerDay: 100_000,
};
function number(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`${label} requires a finite non-negative measurement.`);
  return value;
}
function reference(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    throw new Error(`${label} reference is required.`);
  return value;
}
function fresh(time, now, age, label) {
  const parsed = Date.parse(time ?? "");
  if (!Number.isFinite(parsed) || parsed > now || now - parsed > age)
    throw new Error(`${label} evidence is stale or has an invalid timestamp.`);
}

/** This is an audit of the operator's instruction, never proof of authorization. */
export function validateReleasePolicy(policy, releaseSha, now = Date.now()) {
  if (!policy) return null;
  if (
    policy.mode !== "immediate" ||
    policy.architecture !== "cloudflare-durable" ||
    !SHA.test(releaseSha ?? "") ||
    policy.releaseSha !== releaseSha
  )
    throw new Error(
      "Immediate policy must name this exact Cloudflare Durable Object release.",
    );
  reference(policy.authorizedBy, "Operator");
  reference(policy.authorizationReference, "Operator instruction");
  const authorized = Date.parse(policy.authorizedAt ?? "");
  if (!Number.isFinite(authorized) || authorized > now)
    throw new Error("The real operator instruction timestamp is required.");
  return {
    mode: policy.mode,
    architecture: policy.architecture,
    releaseSha,
    authorizedBy: policy.authorizedBy,
    authorizationReference: policy.authorizationReference,
    authorizedAt: policy.authorizedAt,
  };
}

export function runtimeReleaseIdentity(input) {
  if (
    !input ||
    !SHA.test(input.releaseSha ?? "") ||
    !DIGEST.test(input.artifactDigest ?? "") ||
    !VERSION.test(input.workerVersionId ?? "") ||
    !/^[a-z0-9][a-z0-9-]*$/.test(input.workerName ?? "") ||
    !/^[a-f0-9]{32}$/.test(input.namespaceId ?? "") ||
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(input.namespaceClass ?? "") ||
    input.storage !== "sqlite"
  )
    throw new Error(
      "Exact Worker artifact/version and SQLite namespace identities are required.",
    );
  return Object.fromEntries(
    [
      "workerName",
      "releaseSha",
      "workerVersionId",
      "artifactDigest",
      "namespaceId",
      "namespaceClass",
      "storage",
    ].map((key) => [key, input[key]]),
  );
}
export function sameRuntimeRelease(left, right) {
  return (
    JSON.stringify(runtimeReleaseIdentity(left)) ===
    JSON.stringify(runtimeReleaseIdentity(right))
  );
}

/** The provider readback covers each exact active version and its SQLite namespace. */
export function assertRuntimeDeployments(releases, cloudflare) {
  const namespaces = cloudflare(["durable-objects", "namespaces", "list"]);
  for (const input of Object.values(releases)) {
    const identity = runtimeReleaseIdentity(input);
    const versions = cloudflare([
      "workers",
      "deployments",
      "list",
      "--worker",
      identity.workerName,
    ]).deployments?.[0]?.versions;
    if (
      versions?.length !== 1 ||
      versions[0].percentage !== 100 ||
      versions[0].version_id !== identity.workerVersionId ||
      !Array.isArray(namespaces) ||
      !namespaces.some(
        (row) =>
          row.id === identity.namespaceId &&
          row.script === identity.workerName &&
          row.class === identity.namespaceClass &&
          row.use_sqlite === true,
      )
    )
      throw new Error(
        "Joint runtime version or SQLite namespace readback failed.",
      );
  }
}

/** Budget inventory is required before provisioning; runtime acceptance follows deployment. */
export function assertDurableBudget(input, now = Date.now()) {
  validateReleasePolicy(input.releasePolicy, input.releaseSha, now);
  if (number(input.baseline?.days, "Baseline days") < 14)
    throw new Error("A measured 14-day baseline is still required.");
  fresh(input.baseline.windowEnd, now, 48 * 3600_000, "Baseline");
  if (
    input.cloudflare?.plan !== "free" ||
    !/^[a-f0-9]{32}$/.test(input.cloudflare?.accountId ?? "")
  )
    throw new Error("The measured Cloudflare account must use the Free plan.");
  fresh(input.cloudflare.collectedAt, now, 48 * 3600_000, "Account quota");
  reference(input.cloudflare.evidenceReference, "Provider quota");
  for (const [key, limit] of Object.entries(FREE_QUOTAS)) {
    const usage = input.cloudflare.quotas?.[key];
    if (
      2 * number(usage?.candidate, key) +
        number(usage?.otherAccountUsage, `Shared ${key}`) >=
      limit * 0.8
    )
      throw new Error(
        `${key} lacks 20 percent shared Free headroom at doubled candidate usage.`,
      );
  }
  const candidate = input.durable;
  const forecastUsd = forecastWorkersCost(candidate, 2);
  if (forecastUsd !== 0)
    throw new Error(
      "Cloudflare-only release must add no monthly provider cost.",
    );
  return forecastUsd;
}

/** Preserve trustworthy profiles and account access without substituting elapsed time for tests. */
export function assessWebRelease(input, now = Date.now()) {
  if (!input.releasePolicy) {
    const historical = assessMigration(input);
    if (historical.selected === "hybrid")
      return {
        ...historical,
        selected: null,
        blockers: [
          "Cloud Run is historical and is not an authorized fallback.",
        ],
      };
    return historical;
  }
  let releasePolicy = null;
  const blockers = [];
  let forecastUsd = null;
  try {
    releasePolicy = validateReleasePolicy(
      input.releasePolicy,
      input.releaseSha,
      now,
    );
    forecastUsd = assertDurableBudget(input, now);
    const candidate = input.durable;
    if (candidate.journeysPassed !== true)
      throw new Error("Complete hosted product journeys must pass.");
    if (
      number(candidate.warmP95Ms, "Warm p95") >
        number(input.baseline.warmP95Ms, "Baseline p95") * 1.2 ||
      number(candidate.coldP95Ms, "Cold p95") > 3000
    )
      throw new Error("Hosted warm/cold latency gates failed.");
    if (
      number(candidate.edgeCpuP99Ms, "Edge CPU p99") >= 8 ||
      number(candidate.edgeCpuLimitFailures, "Edge CPU failures") !== 0
    )
      throw new Error(
        "The routing Worker must retain Free request CPU headroom.",
      );
    for (const key of ["web", "api", "discovery"]) {
      const identity = runtimeReleaseIdentity(candidate.runtimeReleases?.[key]);
      if (key === "web" && identity.releaseSha !== input.releaseSha)
        throw new Error("Web runtime evidence belongs to another release.");
      const measured = candidate.measurements?.[key];
      if (!sameRuntimeRelease(identity, measured))
        throw new Error(`${key} measurements belong to another runtime.`);
      fresh(measured.collectedAt, now, TEN_MINUTES, `${key} runtime`);
      reference(measured.evidenceReference, `${key} provider measurement`);
      reference(
        measured.providerLoad?.scopeReference,
        `${key} hosted load scope`,
      );
      if (
        measured.provider !== "cloudflare" ||
        measured.knownMemoryLimitBytes !== 128 * 1024 * 1024 ||
        measured.providerLoad?.representativePassed !== true ||
        measured.providerLoad.maxBoundedPayloadPassed !== true ||
        measured.providerLoad.concurrencyPassed !== true ||
        number(measured.memoryLimitFailures, `${key} memory failures`) !== 0
      )
        throw new Error(
          "Hosted representative, bounded-payload and concurrency probes must pass with no provider memory-limit failures.",
        );
      if (
        measured.peakMemoryBytes !== undefined &&
        (measured.memoryMeasurement !== "provider" ||
          number(measured.peakMemoryBytes, `${key} peak memory`) >=
            measured.knownMemoryLimitBytes)
      )
        throw new Error(
          "Optional peak memory must be provider-measured and within the known runtime limit.",
        );
      // https://developers.cloudflare.com/durable-objects/platform/limits/
      if (
        number(measured.cpuP99Ms, `${key} CPU p99`) >= 30_000 ||
        number(measured.peakConnections, `${key} peak connections`) > 6 ||
        number(measured.limitFailures, `${key} limit failures`) !== 0 ||
        measured.bundleStartupPassed !== true
      )
        throw new Error(
          `${key} Durable Object CPU/memory/connection/startup gates failed.`,
        );
      if (
        key === "discovery" &&
        (number(measured.maxAlarmWallMs, "Discovery alarm wall time") >=
          900_000 ||
          measured.resumableAlarmsPassed !== true)
      )
        throw new Error(
          "Discovery must prove resumable bounded work within the alarm wall limit.",
        );
      if (
        !sameRuntimeRelease(
          identity,
          candidate.rollback?.runtimeReleases?.[key],
        )
      )
        throw new Error(
          "Joint rollback readback must cover this exact web/API/discovery release.",
        );
    }
    if (candidate.rollback?.readbackPassed !== true)
      throw new Error("Joint rollback provider readback has not passed.");
    reference(candidate.rollback.evidenceReference, "Joint rollback");
  } catch (error) {
    blockers.push(error.message);
  }
  return {
    selected: blockers.length ? null : "workers",
    releasePolicy,
    alternatives: {
      workers: {
        currentForecastUsd: forecastUsd === null ? null : forecastUsd / 2,
        forecastUsd,
        passed: blockers.length === 0,
        blockers,
      },
    },
    blockers,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const result = assessWebRelease(
      JSON.parse(readFileSync(process.argv[2], "utf8")),
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.selected) process.exitCode = 1;
  } catch {
    console.error(
      "Provide measured release evidence; no release was selected.",
    );
    process.exitCode = 1;
  }
}
