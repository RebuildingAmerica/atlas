import assert from "node:assert/strict";
import { test } from "node:test";
import { collectVercelBaseline } from "./web-baseline.mjs";

const input = {
  scope: "atlas-team",
  project: "atlas-project",
  since: "2026-09-26T00:00:00Z",
  until: "2026-10-10T00:00:00Z",
  now: new Date("2026-10-10T20:00:00Z"),
};
function response(args) {
  const metric = args[3],
    aggregation = args[args.indexOf("--aggregation") + 1];
  const groupBy = args.flatMap((value, index) =>
    value === "--group-by" ? [args[index + 1]] : [],
  );
  return {
    query: {
      metric,
      aggregation,
      groupBy,
      startTime: new Date(input.since).toISOString(),
      endTime: new Date(input.until).toISOString(),
      bucketTimezone: "UTC",
      granularity: { days: 1 },
      ...(args.includes("--filter")
        ? { filter: "environment eq 'production'" }
        : {}),
    },
    summary: [{ [metric.replaceAll(".", "_") + "_" + aggregation]: 0 }],
    data: Array.from({ length: 14 }, (_, index) => ({
      timestamp: new Date(
        Date.parse(input.since) + index * 86400000,
      ).toISOString(),
      [metric.replaceAll(".", "_") + "_" + aggregation]: 0,
    })),
  };
}

test("baseline uses explicit units, account, project and time window without changing providers", () => {
  const calls = [];
  const result = collectVercelBaseline({
    ...input,
    runner(binary, args) {
      calls.push(args);
      assert.equal(binary, "pnpm");
      assert.equal(args[args.indexOf("--scope") + 1], input.scope);
      assert.equal(args[args.indexOf("--project") + 1], input.project);
      assert.equal(args[args.indexOf("--since") + 1], input.since);
      assert.equal(args[args.indexOf("--until") + 1], input.until);
      return { status: 0, stdout: JSON.stringify(response(args)) };
    },
  });
  assert.equal(result.complete, true);
  assert.equal(result.window.days, 14);
  assert.equal(
    result.measurements.every((m) => Object.values(m.summary[0])[0] === 0),
    true,
  );
  const bytes = calls.filter((args) =>
    args.includes("vercel.request.fdt_out_bytes"),
  );
  assert.ok(bytes.length);
  assert.equal(
    bytes.every((args) => args[args.indexOf("--aggregation") + 1] === "sum"),
    true,
  );
  assert.ok(calls.some((args) => args.includes("function_start_type")));
  assert.ok(calls.some((args) => args.includes("bot_category")));
  assert.ok(calls.some((args) => args.includes("environment eq 'production'")));
});

test("inaccessible or empty measurements stay unknown and never leak provider diagnostics", () => {
  let index = 0;
  const result = collectVercelBaseline({
    ...input,
    runner(_binary, args) {
      index++;
      if (index === 1) return { status: 1, stderr: "private-provider-token" };
      if (index === 2)
        return { status: 0, stdout: JSON.stringify({ summary: [], data: [] }) };
      return { status: 0, stdout: JSON.stringify(response(args)) };
    },
  });
  assert.equal(result.complete, false);
  assert.equal(result.measurements[0].status, "unavailable");
  assert.equal(result.measurements[1].status, "unavailable");
  assert.equal(
    JSON.stringify(result).includes("private-provider-token"),
    false,
  );
  assert.equal("summary" in result.measurements[0], false);
});

test("malformed measurements and truncated grouped buckets cannot appear complete", () => {
  const invalid = collectVercelBaseline({
    ...input,
    runner(_binary, args) {
      const data = response(args);
      data.summary = [{ unknown: 0 }];
      return { status: 0, stdout: JSON.stringify(data) };
    },
  });
  assert.equal(invalid.complete, false);
  const truncated = collectVercelBaseline({
    ...input,
    runner(_binary, args) {
      const data = response(args);
      if (args.includes("--group-by"))
        data.data = Array.from({ length: 100 }, () => ({
          ...data.summary[0],
          timestamp: input.since,
        }));
      return { status: 0, stdout: JSON.stringify(data) };
    },
  });
  assert.equal(truncated.complete, false);
  assert.ok(truncated.measurements.some((m) => m.status === "partial"));
});

test("absent daily observations or mismatched query windows stay incomplete", () => {
  for (const patch of [
    (data) => {
      data.data = [];
    },
    (data) => {
      data.data.pop();
    },
    (data) => {
      data.query.startTime = "2026-10-01T00:00:00.000Z";
    },
    (data) => {
      data.query.filter = "environment eq 'preview'";
    },
    (data) => {
      data.query.groupBy = ["client_ip"];
    },
    (data) => {
      data.data[0].timestamp = "2026-10-20T00:00:00.000Z";
    },
  ]) {
    const result = collectVercelBaseline({
      ...input,
      runner(_binary, args) {
        const data = response(args);
        patch(data);
        return { status: 0, stdout: JSON.stringify(data) };
      },
    });
    assert.equal(result.complete, false);
  }
});

test("missing identity, short, stale or future windows fail before provider calls", () => {
  for (const patch of [
    { scope: "" },
    { project: "" },
    { since: "invalid" },
    { since: "2026-09-26T07:00:00Z", until: "2026-10-10T07:00:00Z" },
    { since: "2026-10-09T07:00:00Z" },
    { now: new Date("2026-10-13T07:00:00Z") },
    { now: new Date("2026-10-09T07:00:00Z") },
  ])
    assert.throws(() =>
      collectVercelBaseline({
        ...input,
        ...patch,
        runner() {
          assert.fail("must not call providers");
        },
      }),
    );
});

test("a null percentile is not applicable only when the matching measured daily invocation count is zero", () => {
  for (const count of [0, 1, null, undefined]) {
    const report = collectVercelBaseline({
      ...input,
      runner(_binary, args) {
        const data = response(args);
        const key = args[3].replaceAll(".", "_") + "_" + data.query.aggregation;
        if (args.includes("function_start_type")) {
          data.summary.forEach((row) => {
            row.function_start_type = "cold";
          });
          data.data.forEach((row) => {
            row.function_start_type = "cold";
          });
          if (args.includes("--filter")) {
            if (data.query.aggregation === "sum") data.data[0][key] = count;
            else data.data[0][key] = null;
          }
        }
        return { status: 0, stdout: JSON.stringify(data) };
      },
    });
    const percentile = report.measurements.find(
      (m) => m.name === "production-ttfb-p95-ms",
    );
    assert.equal(report.complete, count === 0);
    assert.equal(percentile.status, count === 0 ? "measured" : "partial");
    assert.equal(
      percentile.data[0].vercel_function_invocation_ttfb_ms_p95,
      null,
    );
    assert.equal(percentile.notApplicable?.length ?? 0, count === 0 ? 1 : 0);
    if (count === 0)
      assert.deepEqual(percentile.notApplicable[0], {
        timestamp: new Date(input.since).toISOString(),
        functionStartType: "cold",
        reason: "Matching production invocation count is zero.",
      });
  }
});

test("a different start category or day cannot explain a null percentile", () => {
  const report = collectVercelBaseline({
    ...input,
    runner(_binary, args) {
      const data = response(args);
      if (args.includes("function_start_type")) {
        data.data.forEach((row) => {
          row.function_start_type =
            data.query.aggregation === "sum" ? "hot" : "cold";
        });
        if (data.query.aggregation !== "sum") {
          data.data[0][
            args[3].replaceAll(".", "_") + "_" + data.query.aggregation
          ] = null;
        }
      }
      return { status: 0, stdout: JSON.stringify(data) };
    },
  });
  assert.equal(report.complete, false);
  assert.equal(
    report.measurements.find((m) => m.name === "production-ttfb-p95-ms").status,
    "partial",
  );
});
