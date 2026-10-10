import assert from "node:assert/strict";
import { test } from "node:test";
import {
  probeWebRelease,
  summarizeWebObservations,
  webObservationSettings,
} from "./web-observe.mjs";

test("production observation follows the promoted canonical domain without Access credentials", () => {
  const credentials = {
    ATLAS_HOSTED_CF_ACCESS_CLIENT_ID: "private-id",
    ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET: "private-secret",
  };
  const candidate = { candidateUrl: "https://candidate.atlas.example.com" };
  assert.deepEqual(webObservationSettings(candidate, credentials), {
    origin: candidate.candidateUrl,
    clientId: "private-id",
    clientSecret: "private-secret",
  });
  const production = {
    ...candidate,
    target: "production",
    productionUrl: "https://atlas.example.com",
    promotionState: "active",
    publicEnv: { ATLAS_PUBLIC_URL: "https://atlas.example.com" },
  };
  assert.deepEqual(webObservationSettings(production, credentials), {
    origin: production.productionUrl,
  });
  assert.throws(() =>
    webObservationSettings(
      { ...production, promotionState: "prepared" },
      credentials,
    ),
  );
  assert.throws(() =>
    webObservationSettings(
      { ...production, productionUrl: "https://unrelated.example.com" },
      credentials,
    ),
  );
});

const sha = "a".repeat(40);
const origin = "https://candidate.atlas.example.com";
const secrets = {
  clientId: "private-id",
  clientSecret: "private-access",
  hostedSecret: "private-hosted",
};
const billingChecks = [
  "Runtime key",
  "Charge-enabled account",
  "Stripe Tax",
  "Customer portal",
  "Catalog IDs",
  "Webhook endpoint metadata",
].map((name) => ({ name, status: "pass" }));
function provider(url, init) {
  const path = new URL(url).pathname;
  assert.equal(new URL(url).origin, origin);
  assert.equal(init.redirect, "manual");
  if (!init.headers.get("cf-access-client-id"))
    return new Response("Access denied", { status: 403 });
  if (path === "/api/e2e/hosted/billing-inventory") {
    assert.equal(
      init.headers.get("x-atlas-hosted-e2e-secret"),
      secrets.hostedSecret,
    );
    return Response.json({ revision: sha, checks: billingChecks });
  }
  assert.equal(init.headers.get("x-atlas-hosted-e2e-secret"), null);
  if (path === "/api/health") return Response.json({ status: "ok" });
  if (path === "/api/auth/get-session")
    return Response.json(null, {
      headers: { "cache-control": "private, no-store" },
    });
  if (path === "/api/entities") {
    const type = new URL(url).searchParams.get("entity_type");
    return Response.json({
      items: [
        {
          slug:
            type === "person" ? "published-person" : "published-organization",
        },
      ],
    });
  }
  if (path === "/profiles/people/published-organization")
    return new Response("Wrong profile", { status: 404 });
  if (path === "/mcp" || path === "/mcp/")
    return new Response(null, {
      status: 401,
      headers: {
        "www-authenticate":
          'Bearer resource_metadata="https://candidate.atlas.example.com/.well-known/oauth-protected-resource/mcp"',
      },
    });
  return new Response(
    '<!doctype html><html><body><h1>Atlas</h1><a href="https://source.example.com">Source</a></body></html>',
    {
      headers: {
        "content-type": "text/html",
        "cache-control": "private, no-store",
      },
    },
  );
}
const input = {
  workerName: "atlas-workers-staging-" + sha.slice(0, 12),
  workerVersionId: "12345678-1234-1234-1234-123456789abc",
  artifactDigest: "b".repeat(64),
  assetsDigest: "c".repeat(64),
  cloudflare: () => ({
    deployments: [
      {
        versions: [
          {
            version_id: "12345678-1234-1234-1234-123456789abc",
            percentage: 100,
          },
        ],
      },
    ],
  }),
  origin,
  releaseSha: sha,
  target: "staging",
  architecture: "workers",
  ...secrets,
};

test("hosted observation verifies the exact release, rendered pages, anonymous identity and billing without exposing credentials", async () => {
  const report = await probeWebRelease({ ...input, fetcher: provider });
  assert.equal(report.status, "pass");
  assert.ok(report.checks.length >= 14);
  assert.ok(report.checks.every((check) => check.status === "pass"));
  for (const value of Object.values(secrets))
    assert.equal(JSON.stringify(report).includes(value), false);
  assert.equal(report.journeysPassed, undefined);
  assert.equal(report.cpuP99Ms, undefined);
});

test("external redirects never receive Access or hosted credentials and cannot count as rendered pages", async () => {
  const urls = [];
  const report = await probeWebRelease({
    ...input,
    fetcher: (url, init) => {
      urls.push(url);
      if (new URL(url).pathname === "/browse")
        return new Response(null, {
          status: 302,
          headers: { location: "https://outside.example.com/private-access" },
        });
      return provider(url, init);
    },
  });
  assert.equal(report.status, "fail");
  assert.ok(urls.every((url) => new URL(url).origin === origin));
  assert.equal(JSON.stringify(report).includes("private-access"), false);
  assert.equal(
    report.checks.find((check) => check.name === "page:/browse").status,
    "fail",
  );
});

test("wrong release, broken SSR, unhealthy API and another user's anonymous session each fail observation", async () => {
  for (const path of [
    "/api/e2e/hosted/billing-inventory",
    "/browse",
    "/api/health",
    "/api/auth/get-session",
  ]) {
    const report = await probeWebRelease({
      ...input,
      fetcher: (url, init) => {
        if (
          new URL(url).pathname !== path ||
          !init.headers.get("cf-access-client-id")
        )
          return provider(url, init);
        if (path.endsWith("billing-inventory"))
          return Response.json({
            revision: "b".repeat(40),
            checks: billingChecks,
          });
        if (path === "/browse")
          return new Response(
            '<html><body data-testid="route-error-panel">Something went wrong</body></html>',
            { headers: { "content-type": "text/html" } },
          );
        if (path.endsWith("health"))
          return Response.json({ status: "degraded" }, { status: 503 });
        return Response.json(
          {
            user: { id: "private-other-user" },
            session: { id: "private-session" },
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    });
    assert.equal(report.status, "fail", path);
    assert.equal(JSON.stringify(report).includes("private-other-user"), false);
  }
});

test("malformed target, origin, SHA or incomplete credentials fail before requests", async () => {
  for (const patch of [
    { origin: "http://candidate.example.com" },
    { origin: origin + "/path" },
    { origin: "https://user:private@example.com" },
    { releaseSha: "main" },
    { clientSecret: "" },
    { hostedSecret: "" },
    { target: "other" },
    { architecture: "other" },
  ]) {
    await assert.rejects(() =>
      probeWebRelease({
        ...input,
        ...patch,
        fetcher: () => {
          assert.fail("must not call");
        },
      }),
    );
  }
});

test("a continuous observation window requires a full day of fresh passing probes from the exact release", async () => {
  const start = Date.parse("2026-10-10T00:00:00Z");
  const sample = await probeWebRelease({
    ...input,
    fetcher: provider,
    now: () => new Date(start),
  });
  const records = Array.from({ length: 289 }, (_, index) => ({
    ...sample,
    collectedAt: new Date(start + index * 300000).toISOString(),
  }));
  const result = summarizeWebObservations(records, {
    ...input,
    now: start + 86400000,
  });
  assert.equal(result.continuousChecksPassed, true);
  assert.equal(result.observations, 289);
  for (const modify of [
    (rows) => rows.slice(1),
    (rows) => rows.filter((_, i) => i < 100 || i > 104),
    (rows) =>
      rows.map((row, i) =>
        i === 100
          ? {
              ...row,
              checks: row.checks.map((check, j) =>
                j === 0 ? { ...check, status: "fail" } : check,
              ),
            }
          : row,
      ),
    (rows) => rows.map((row, i) => (i === 100 ? { ...row, checks: [] } : row)),
  ])
    assert.equal(
      summarizeWebObservations(modify(records), {
        ...input,
        now: start + 86400000,
      }).continuousChecksPassed,
      false,
    );
  assert.equal(
    summarizeWebObservations(records, {
      ...input,
      now: start + 86400000 + 660000,
    }).continuousChecksPassed,
    false,
  );
  for (const patch of [
    { releaseSha: "b".repeat(40) },
    { origin: "https://wrong.example.com" },
    { collectedAt: new Date(start + 86400001).toISOString() },
  ]) {
    assert.throws(() =>
      summarizeWebObservations(
        [...records.slice(0, -1), { ...records.at(-1), ...patch }],
        { ...input, now: start + 86400000 },
      ),
    );
  }
  assert.throws(() =>
    summarizeWebObservations([...records, records.at(-1)], {
      ...input,
      now: start + 86400000,
    }),
  );
});

test("72-hour production observation cannot be replaced with a staging day", async () => {
  const start = Date.parse("2026-10-10T00:00:00Z");
  const sample = await probeWebRelease({
    ...input,
    fetcher: provider,
    now: () => new Date(start),
  });
  const rows = Array.from({ length: 865 }, (_, i) => ({
    ...sample,
    collectedAt: new Date(start + i * 300000).toISOString(),
  }));
  assert.equal(
    summarizeWebObservations(rows, {
      ...input,
      now: start + 72 * 3600000,
      minimumHours: 72,
    }).continuousChecksPassed,
    true,
  );
  assert.equal(
    summarizeWebObservations(rows.slice(0, 289), {
      ...input,
      now: start + 24 * 3600000,
      minimumHours: 72,
    }).continuousChecksPassed,
    false,
  );
  assert.throws(() =>
    summarizeWebObservations(rows, {
      ...input,
      now: start + 72 * 3600000,
      minimumHours: 0,
    }),
  );
});

test("hybrid direct-origin checks carry no verifier credentials and reject a bypassable origin", async () => {
  for (const status of [403, 200]) {
    const originUrl = "https://release---atlas-web-abc-uc.a.run.app";
    const report = await probeWebRelease({
      ...input,
      architecture: "hybrid",
      workerName: "atlas-hybrid-staging-" + sha.slice(0, 12),
      revision: "atlas-web-staging-release",
      imageDigest: "registry.example.com/atlas@sha256:" + "d".repeat(64),
      google: (args) =>
        args.includes("services")
          ? {
              status: {
                traffic: [
                  { url: originUrl, revisionName: "atlas-web-staging-release" },
                ],
              },
            }
          : {
              status: {
                imageDigest:
                  "registry.example.com/atlas@sha256:" + "d".repeat(64),
                conditions: [{ type: "Ready", status: "True" }],
              },
            },
      originUrl,
      fetcher: (url, init) => {
        if (new URL(url).origin !== originUrl) return provider(url, init);
        assert.equal(init.headers, undefined);
        assert.equal(init.redirect, "manual");
        return new Response(null, { status });
      },
    });
    assert.equal(report.status, status === 403 ? "pass" : "fail");
  }
});

test("same-origin redirects retain Access credentials and the observation rejects disabled Access", async () => {
  let redirected = false;
  const report = await probeWebRelease({
    ...input,
    fetcher: (url, init) => {
      if (new URL(url).pathname === "/browse")
        return new Response(null, {
          status: 302,
          headers: { location: "/browse/" },
        });
      if (new URL(url).pathname === "/browse/") redirected = true;
      if (!init.headers.get("cf-access-client-id"))
        return new Response("unexpected public access");
      return provider(url, init);
    },
  });
  assert.equal(redirected, true);
  assert.equal(
    report.checks.find((c) => c.name === "page:/browse").status,
    "pass",
  );
  assert.equal(
    report.checks.find((c) => c.name === "access-denial").status,
    "fail",
  );
});

test("candidate verifier configuration is checked before provisioning without enabling test routes or replacing secrets", async () => {
  const { assertWebObserverConfiguration } = await import("./web-observe.mjs");
  const runtime = {
    ATLAS_HOSTED_E2E_ENABLED: "1",
    ATLAS_HOSTED_E2E_PRODUCTION_ENABLED: "1",
    ATLAS_HOSTED_E2E_SECRET: secrets.hostedSecret,
  };
  assert.doesNotThrow(() => assertWebObserverConfiguration(runtime, secrets));
  for (const patch of [
    { ATLAS_HOSTED_E2E_ENABLED: "0" },
    { ATLAS_HOSTED_E2E_PRODUCTION_ENABLED: undefined },
    { ATLAS_HOSTED_E2E_SECRET: "different-private-key" },
  ])
    assert.throws(() =>
      assertWebObserverConfiguration({ ...runtime, ...patch }, secrets),
    );
  for (const patch of [
    { clientId: "" },
    { clientSecret: "" },
    { hostedSecret: "wrong-private-secret" },
  ])
    assert.throws(() =>
      assertWebObserverConfiguration(runtime, { ...secrets, ...patch }),
    );
});

test("active Worker versions and exact artifact identity must match every observation", async () => {
  const sample = await probeWebRelease({ ...input, fetcher: provider });
  assert.equal(sample.workerVersionId, input.workerVersionId);
  assert.equal(sample.artifactDigest, input.artifactDigest);
  assert.equal(sample.assetsDigest, input.assetsDigest);
  const switched = await probeWebRelease({
    ...input,
    fetcher: provider,
    cloudflare: () => ({
      deployments: [
        {
          versions: [
            {
              version_id: "87654321-1234-1234-1234-123456789abc",
              percentage: 100,
            },
          ],
        },
      ],
    }),
  });
  assert.equal(switched.status, "fail");
  assert.equal(
    switched.checks.find((c) => c.name === "active-deployment").status,
    "fail",
  );
  for (const patch of [
    { workerVersionId: "87654321-1234-1234-1234-123456789abc" },
    { artifactDigest: "e".repeat(64) },
    { assetsDigest: "f".repeat(64) },
  ]) {
    assert.throws(() =>
      summarizeWebObservations([{ ...sample, ...patch }], input),
    );
  }
});
