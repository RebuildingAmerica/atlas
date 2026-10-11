#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function number(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} needs a measured, finite, non-negative value.`);
  }
  return value;
}

/** Conservative incremental forecast; allowances are the measured unused account balance. */
export function forecastMonthlyCost(candidate, multiplier) {
  const usage = candidate.monthly;
  const free = candidate.freeRemaining;
  const rates = candidate.rates;
  const billable = (key) =>
    Math.max(
      0,
      number(usage?.[key], key) * multiplier -
        number(free?.[key], `free ${key}`),
    );
  return (
    billable("cpuSeconds") * number(rates?.cpuSecondUsd, "CPU rate") +
    billable("gibSeconds") * number(rates?.gibSecondUsd, "memory rate") +
    (billable("requests") / 1_000_000) *
      number(rates?.millionRequestsUsd, "request rate") +
    billable("egressGiB") * number(rates?.egressGiBUsd, "egress rate") +
    ["storageUsd", "buildsUsd", "logsUsd", "databaseUsd"].reduce(
      (sum, key) => sum + number(usage?.[key], key) * multiplier,
      0,
    )
  );
}

export function forecastWorkersCost(candidate, multiplier) {
  return [
    "databaseUsd",
    "networkUsd",
    "buildsUsd",
    "storageUsd",
    "logsUsd",
  ].reduce(
    (sum, key) =>
      sum +
      number(candidate?.addedMonthlyCosts?.[key], `Workers added ${key}`) *
        multiplier,
    0,
  );
}

/** Fail closed: a build or low traffic is never a substitute for hosted evidence. */
export function assessMigration(input) {
  const blockers = [];
  const alternatives = {};
  try {
    if (number(input.baseline?.days, "baseline days") < 14)
      throw new Error("A 14-day baseline is required.");
    number(input.baseline?.warmP95Ms, "baseline latency");
    number(input.baseline?.peakDynamicRequestsPerDay, "peak daily requests");
    if (input.cloudflare?.plan !== "free")
      throw new Error("Cloudflare must be on the Free plan.");
    if (
      2 * input.baseline.peakDynamicRequestsPerDay +
        number(
          input.cloudflare.otherRequestsPerDay,
          "other account requests",
        ) >=
      80_000
    ) {
      throw new Error(
        "Doubled dynamic traffic plus account usage must stay below 80,000 requests/day.",
      );
    }
  } catch (error) {
    return { selected: null, alternatives, blockers: [error.message] };
  }
  for (const name of ["workers", "hybrid"]) {
    const candidate = input[name];
    const failures = [];
    let forecastUsd = null;
    let currentForecastUsd = null;
    try {
      const forecast =
        name === "workers" ? forecastWorkersCost : forecastMonthlyCost;
      currentForecastUsd = forecast(candidate, 1);
      forecastUsd = forecast(candidate, 2);
      if (candidate?.journeysPassed !== true)
        throw new Error("Hosted user journeys have not passed.");
      if (
        number(candidate.warmP95Ms, "warm latency") >
        input.baseline.warmP95Ms * 1.2
      )
        throw new Error("Warm p95 exceeds baseline by more than 20%.");
      if (number(candidate.coldP95Ms, "cold latency") > 3000)
        throw new Error("Cold SSR p95 exceeds 3 seconds.");
      if (name === "workers") {
        if (candidate.limitsPassed !== true)
          throw new Error(
            "Bundle/startup/memory/connection limits are unverified.",
          );
        if (
          number(candidate.cpuP99Ms, "CPU p99") >= 8 ||
          number(candidate.cpuLimitFailures, "CPU failures") !== 0
        )
          throw new Error("Workers CPU gate failed.");
        if (
          2 * number(candidate.queriesPerDay, "daily queries") +
            number(
              input.cloudflare.otherQueriesPerDay,
              "other account queries",
            ) >=
          80_000
        )
          throw new Error("Hyperdrive daily query headroom failed.");
      } else {
        if (candidate.originProtected !== true)
          throw new Error("Direct origin protection is unverified.");
        forecastUsd = forecastMonthlyCost(candidate, 2);
        if (forecastUsd > 5)
          throw new Error("Added forecast at twice traffic exceeds $5/month.");
      }
    } catch (error) {
      failures.push(error.message);
    }
    alternatives[name] = {
      currentForecastUsd,
      passed: failures.length === 0,
      forecastUsd,
      blockers: failures,
    };
    blockers.push(...failures.map((message) => `${name}: ${message}`));
  }
  const forecastsReady = Object.values(alternatives).every(
    (candidate) => candidate.currentForecastUsd !== null,
  );
  const selected = !forecastsReady
    ? null
    : alternatives.workers.passed
      ? "workers"
      : alternatives.hybrid.passed
        ? "hybrid"
        : null;
  return { selected, alternatives, blockers: selected ? [] : blockers };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const result = assessMigration(
      JSON.parse(readFileSync(process.argv[2], "utf8")),
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.selected) process.exitCode = 1;
  } catch {
    console.error(
      "Provide a complete measured migration evidence JSON file; no candidate was selected.",
    );
    process.exitCode = 1;
  }
}
