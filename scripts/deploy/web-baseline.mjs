#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const DAY = 86_400_000;

// Keep requests, bytes and server work separate so a cheap move preserves fast
// search, profile rendering and sign-in under the actual workload.
const QUERIES = [
  { name: "requests", metric: "request.count", aggregation: "sum" },
  {
    name: "request-statuses",
    metric: "request.count",
    aggregation: "sum",
    groupBy: ["http_status"],
  },
  {
    name: "request-environments",
    metric: "request.count",
    aggregation: "sum",
    groupBy: ["environment"],
  },
  {
    name: "request-bots",
    metric: "request.count",
    aggregation: "sum",
    groupBy: ["bot_category"],
  },
  {
    name: "request-path-types",
    metric: "request.count",
    aggregation: "sum",
    groupBy: ["path_type"],
  },
  {
    name: "response-bytes",
    metric: "request.fdt_out_bytes",
    aggregation: "sum",
  },
  {
    name: "function-starts",
    metric: "function_invocation.count",
    aggregation: "sum",
    groupBy: ["function_start_type"],
  },
  {
    name: "function-routes",
    metric: "function_invocation.count",
    aggregation: "sum",
    groupBy: ["route"],
  },
  {
    name: "function-paths",
    metric: "function_invocation.count",
    aggregation: "sum",
    groupBy: ["request_path"],
  },
  {
    name: "function-cpu-ms",
    metric: "function_invocation.function_cpu_time_ms",
    aggregation: "sum",
  },
  {
    name: "function-duration-ms",
    metric: "function_invocation.function_duration_ms",
    aggregation: "sum",
  },
  {
    name: "function-memory-gbhr",
    metric: "function_invocation.function_duration_gbhr",
    aggregation: "sum",
  },
  {
    name: "function-response-bytes",
    metric: "function_invocation.fot_out_bytes",
    aggregation: "sum",
  },
  {
    name: "production-requests",
    metric: "request.count",
    aggregation: "sum",
    production: true,
  },
  {
    name: "production-function-starts",
    metric: "function_invocation.count",
    aggregation: "sum",
    groupBy: ["function_start_type"],
    production: true,
  },
  {
    name: "production-ttfb-p95-ms",
    metric: "function_invocation.ttfb_ms",
    aggregation: "p95",
    groupBy: ["function_start_type"],
    production: true,
  },
  {
    name: "production-duration-p95-ms",
    metric: "function_invocation.function_duration_ms",
    aggregation: "p95",
    groupBy: ["function_start_type"],
    production: true,
  },
  {
    name: "production-cpu-p99-ms",
    metric: "function_invocation.function_cpu_time_ms",
    aggregation: "p99",
    groupBy: ["function_start_type"],
    production: true,
  },
];

/** Read provider measurements; unavailable data never becomes a zero or approval. */
export function collectVercelBaseline({
  scope,
  project,
  since,
  until,
  now = new Date(),
  runner = spawnSync,
}) {
  const start = Date.parse(since),
    end = Date.parse(until);
  if (!scope?.trim() || !project?.trim())
    throw new Error("Explicit Vercel scope and project are required.");
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end - start !== 14 * DAY ||
    start % DAY !== 0 ||
    end % DAY !== 0
  )
    throw new Error(
      "Provide 14 complete UTC days, with ISO timestamps at midnight UTC.",
    );
  if (end > now.getTime() || now.getTime() - end > 2 * DAY)
    throw new Error(
      "The baseline must end within the last 48 hours, never in the future.",
    );
  let productionStarts = [];
  const measurements = QUERIES.map(
    ({ name, metric, aggregation, groupBy = [], production = false }) => {
      const args = [
        "exec",
        "vercel",
        "metrics",
        `vercel.${metric}`,
        "--scope",
        scope,
        "--project",
        project,
        "--since",
        since,
        "--until",
        until,
        "--aggregation",
        aggregation,
        "--granularity",
        "1d",
        "--bucket-timezone",
        "UTC",
        "--format",
        "json",
        "--limit",
        "100",
      ];
      for (const dimension of groupBy) args.push("--group-by", dimension);
      if (production) args.push("--filter", "environment eq 'production'");
      const description = {
        name,
        metric: `vercel.${metric}`,
        aggregation,
        groupBy,
        production,
        maxGroupsPerBucket: 100,
      };
      try {
        const result = runner("pnpm", args, {
          cwd: ROOT,
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          timeout: 60_000,
        });
        if (result.error || result.status !== 0) throw new Error("unavailable");
        const value = JSON.parse(result.stdout);
        if (
          !Array.isArray(value.summary) ||
          !value.summary.length ||
          !Array.isArray(value.data) ||
          value.query?.metric !== description.metric ||
          value.query?.aggregation !== aggregation ||
          Date.parse(value.query?.startTime) !== start ||
          Date.parse(value.query?.endTime) !== end ||
          value.query?.bucketTimezone !== "UTC" ||
          value.query?.granularity?.days !== 1 ||
          value.query?.filter !==
            (production ? "environment eq 'production'" : undefined) ||
          JSON.stringify(value.query?.groupBy) !== JSON.stringify(groupBy)
        )
          throw new Error("unavailable");
        const key = description.metric.replaceAll(".", "_") + "_" + aggregation;
        if (
          value.summary.some(
            (row) =>
              typeof row[key] !== "number" ||
              !Number.isFinite(row[key]) ||
              row[key] < 0,
          )
        )
          throw new Error("unavailable");
        const buckets = new Map();
        for (const row of value.data) {
          const timestamp = Date.parse(row.timestamp);
          if (
            !Number.isFinite(timestamp) ||
            timestamp < start ||
            timestamp >= end ||
            timestamp % DAY !== 0
          )
            throw new Error("unavailable");
          buckets.set(timestamp, (buckets.get(timestamp) ?? 0) + 1);
        }
        const truncated =
          groupBy.length > 0 &&
          [...buckets.values()].some((count) => count >= 100);
        const notApplicable = value.data.filter((row) => {
          if (
            aggregation === "sum" ||
            !production ||
            row[key] !== null ||
            typeof row.function_start_type !== "string"
          )
            return false;
          const counts = productionStarts.filter(
            (count) =>
              count.timestamp === row.timestamp &&
              count.function_start_type === row.function_start_type,
          );
          return (
            counts.length === 1 &&
            counts[0].vercel_function_invocation_count_sum === 0
          );
        });
        const incomplete =
          buckets.size !== 14 ||
          (!groupBy.length &&
            [...buckets.values()].some((count) => count !== 1)) ||
          value.data
            .filter((row) => !notApplicable.includes(row))
            .some(
              (row) =>
                typeof row[key] !== "number" ||
                !Number.isFinite(row[key]) ||
                row[key] < 0,
            );
        if (name === "production-function-starts" && !truncated && !incomplete)
          productionStarts = value.data;
        return {
          ...description,
          status: truncated || incomplete ? "partial" : "measured",
          query: value.query,
          summary: value.summary,
          data: value.data,
          ...(notApplicable.length
            ? {
                notApplicable: notApplicable.map((row) => ({
                  timestamp: row.timestamp,
                  functionStartType: row.function_start_type,
                  reason: "Matching production invocation count is zero.",
                })),
              }
            : {}),
        };
      } catch {
        return { ...description, status: "unavailable" };
      }
    },
  );
  return {
    schemaVersion: 1,
    kind: "vercel-workload-baseline",
    scope,
    project,
    window: { since, until, days: 14, bucketTimezone: "UTC" },
    collectedAt: now.toISOString(),
    complete: measurements.every((m) => m.status === "measured"),
    limitations: [
      "Grouped queries return at most 100 groups per daily bucket; inspect for truncation.",
      "Vercel CPU measurements do not establish Workers CPU compatibility.",
      "Account-wide Cloudflare and Google usage, forecasts and hosted acceptance remain separate release gates.",
    ],
    measurements,
  };
}

function main(args) {
  const value = (key) =>
    args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const output = value("--output");
  if (!output)
    throw new Error("An ignored --output .atlas/... file is required.");
  const file = resolve(ROOT, output);
  if (!file.startsWith(resolve(ROOT, ".atlas") + sep))
    throw new Error("Baseline output must stay under .atlas/.");
  const report = collectVercelBaseline({
    scope: value("--scope"),
    project: value("--project"),
    since: value("--since"),
    until: value("--until"),
  });
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(
    JSON.stringify({
      output: file,
      complete: report.complete,
      unavailable: report.measurements
        .filter((m) => m.status !== "measured")
        .map((m) => m.name),
    }),
  );
  if (!report.complete) process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
