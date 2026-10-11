import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadWebRuntime,
  assertCandidateBudget,
  candidateRuntime,
  assertAccessPolicy,
  assertCandidateDomain,
  durableCandidateBindings,
  assertDurableDependencies,
} from "./web-candidate.mjs";
import { doctor, webReleaseBuildSettings } from "./web-hosting.mjs";

const runtime = () => ({
  ATLAS_PUBLIC_URL: "https://atlas.example.com",
  ATLAS_SERVER_API_PROXY_TARGET: "https://api.example.com",
  ATLAS_MANAGED: "true",
  ATLAS_MULTI_USER: "true",
  ATLAS_AUTH_INTERNAL_SECRET: "existing-signing-secret",
  DATABASE_URL: "postgres://user:password@db.example.com/atlas",
  ATLAS_EMAIL_RESEND_API_KEY: "existing-email-key",
  ATLAS_AUTH_JWT_AUDIENCES: "https://atlas.example.com/mcp",
  ATLAS_AUTH_API_KEY_INTROSPECTION_URL:
    "https://atlas.example.com/api/auth/internal/api-key",
});

test("publication requires the candidate domain on the intended Worker and zone", () => {
  const expected = {
    workerName: "atlas-candidate",
    hostname: "candidate.atlas.example.com",
    zoneId: "atlas-zone",
  };
  const worker = {
    name: expected.workerName,
    references: {
      domains: [{ hostname: expected.hostname, zone_id: expected.zoneId }],
    },
  };
  assert.doesNotThrow(() => assertCandidateDomain(worker, expected));
  for (const observed of [
    {},
    { ...worker, name: "another-worker" },
    { ...worker, references: { domains: [] } },
    {
      ...worker,
      references: {
        domains: [
          { hostname: "another.example.com", zone_id: expected.zoneId },
        ],
      },
    },
    {
      ...worker,
      references: {
        domains: [{ hostname: expected.hostname, zone_id: "another-zone" }],
      },
    },
  ])
    assert.throws(
      () => assertCandidateDomain(observed, expected),
      /domain readback/,
    );
});

test("accepts the existing canonical runtime and rejects provider credentials or missing identity secrets", () => {
  assert.deepEqual(loadWebRuntime(JSON.stringify(runtime())), runtime());
  for (const patch of [
    { CLOUDFLARE_API_TOKEN: "must-not-copy" },
    { ATLAS_AUTH_INTERNAL_SECRET: "" },
    { DATABASE_URL: "sqlite:///atlas.db" },
    { ATLAS_PUBLIC_URL: "http://atlas.example.com" },
    { ATLAS_AUTH_JWT_AUDIENCES: "https://wrong.example/mcp" },
    { ATLAS_MULTI_USER: "false" },
  ]) {
    assert.throws(() =>
      loadWebRuntime(JSON.stringify({ ...runtime(), ...patch })),
    );
  }
});
test("candidate provisioning refuses absent traffic or quota evidence before any provider writes", () => {
  assert.throws(() => assertCandidateBudget({}, "workers"), /baseline/);
});

test("approved DO builds pin existing API and discovery versions and compile the object export", () => {
  const releaseSha = "a".repeat(40);
  const dependency = {
    workerName: "atlas-api",
    releaseSha,
    artifactDigest: "b".repeat(64),
    workerVersionId: "12345678-1234-1234-1234-123456789abc",
    namespaceId: "c".repeat(32),
    namespaceClass: "ApiRuntime",
    storage: "sqlite",
  };
  const evidence = {
    releasePolicy: {
      mode: "immediate",
      architecture: "cloudflare-durable",
      releaseSha,
      authorizedBy: "Operator",
      authorizationReference: "User waiver",
      authorizedAt: new Date().toISOString(),
    },
    durable: { runtimeReleases: { api: dependency, discovery: dependency } },
  };
  const settings = webReleaseBuildSettings({
    architecture: "workers",
    releaseSha,
    evidence,
    env: {},
  });
  assert.equal(settings.execution, "cloudflare-durable");
  assert.equal(settings.buildExecution, "durable-production");
  assert.deepEqual(
    settings.runtimeDependencies,
    evidence.durable.runtimeReleases,
  );
  assert.throws(() =>
    webReleaseBuildSettings({
      architecture: "hybrid",
      releaseSha,
      evidence,
      env: {},
    }),
  );
  assert.throws(() =>
    webReleaseBuildSettings({
      architecture: "workers",
      releaseSha,
      env: { ATLAS_WORKERS_EXECUTION: "durable-evaluation" },
    }),
  );
  assert.throws(() =>
    webReleaseBuildSettings({
      architecture: "workers",
      releaseSha,
      env: { ATLAS_WORKERS_EXECUTION: "durable-production" },
    }),
  );
  const manifest = {
    execution: settings.execution,
    workerName: "atlas-web",
    runtimeDependencies: settings.runtimeDependencies,
  };
  const compiled = {
    exports: {
      AtlasAppRuntime: { type: "durable-object", storage: "sqlite" },
    },
    env: {
      ATLAS_WORKERS_EXECUTION: { type: "text", value: "durable-production" },
    },
  };
  assert.deepEqual(durableCandidateBindings(manifest, compiled), {
    APP_RUNTIME: {
      type: "durable-object",
      worker: "atlas-web",
      exportName: "AtlasAppRuntime",
    },
    ATLAS_API_ROUTE_PREFIX: { type: "text", value: "" },
    API_RUNTIME: {
      type: "durable-object",
      worker: "atlas-api",
      exportName: "ApiRuntime",
    },
  });
  for (const marker of [
    undefined,
    { type: "text", value: "durable-evaluation" },
    { type: "text", value: "direct" },
    { type: "secret", value: "durable-production" },
  ])
    assert.throws(
      () =>
        durableCandidateBindings(manifest, {
          ...compiled,
          env: { ATLAS_WORKERS_EXECUTION: marker },
        }),
      /production execution marker/,
    );
  assert.throws(() => durableCandidateBindings(manifest, { exports: {} }));
  const provider = (args) =>
    args[0] === "durable-objects"
      ? [
          {
            id: dependency.namespaceId,
            script: dependency.workerName,
            class: "ApiRuntime",
            use_sqlite: true,
          },
        ]
      : {
          deployments: [
            {
              versions: [
                { version_id: dependency.workerVersionId, percentage: 100 },
              ],
            },
          ],
        };
  assert.doesNotThrow(() =>
    assertDurableDependencies(settings.runtimeDependencies, provider),
  );
  assert.throws(() =>
    assertDurableDependencies(settings.runtimeDependencies, () => ({
      deployments: [],
    })),
  );
});
test("doctor reports missing inputs without changing providers or printing credentials", async () => {
  const keys = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "GCP_PROJECT_ID",
    "GCP_REGION",
    "VERCEL_ORG_ID",
    "VERCEL_TOKEN",
    "ATLAS_WEB_EVIDENCE_FILE",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);
  try {
    const output = await doctor({
      target: "staging",
      fetcher: async () => {
        throw new Error("must not call");
      },
      tool: () => {
        throw new Error("must not call");
      },
    });
    assert.equal(output.status, "block");
    assert.equal(output.checks.length, 4);
    assert.ok(output.checks.every((check) => check.status === "block"));
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("candidate identity keeps RP ID and signing secrets while all auth links use its own host", () => {
  const original = runtime();
  const sha = "a".repeat(40);
  const candidate = candidateRuntime(
    original,
    "staging",
    "hybrid",
    sha,
    "example.com",
  );
  assert.equal(
    candidate.ATLAS_PUBLIC_URL,
    "https://atlas-hybrid-staging-aaaaaaaaaaaa.atlas.example.com",
  );
  assert.equal(candidate.ATLAS_WEB_CANONICAL_URL, original.ATLAS_PUBLIC_URL);
  assert.equal(candidate.ATLAS_PASSKEY_RP_ID, "atlas.example.com");
  assert.equal(
    candidate.ATLAS_AUTH_INTERNAL_SECRET,
    original.ATLAS_AUTH_INTERNAL_SECRET,
  );
  assert.equal(
    candidate.ATLAS_AUTH_API_KEY_INTROSPECTION_URL,
    candidate.ATLAS_PUBLIC_URL + "/api/auth/internal/api-key",
  );
  assert.equal(
    candidate.ATLAS_AUTH_JWT_AUDIENCES,
    original.ATLAS_AUTH_JWT_AUDIENCES,
  );
  assert.deepEqual(loadWebRuntime(JSON.stringify(candidate)), candidate);
  assert.throws(
    () => candidateRuntime(original, "staging", "hybrid", sha, "unrelated.org"),
    /outside/,
  );
  assert.throws(
    () => candidateRuntime(candidate, "staging", "hybrid", sha, "example.com"),
    /original/,
  );
});

test("Access readback rejects additional public or token grants", () => {
  const app = { type: "self_hosted", domain: "candidate.atlas.example.com" };
  const policy = {
    decision: "non_identity",
    include: [{ service_token: { token_id: "expected" } }],
  };
  assertAccessPolicy(app, [policy], app.domain, "expected");
  for (const extra of [
    { everyone: {} },
    { service_token: { token_id: "other" } },
  ])
    assert.throws(() =>
      assertAccessPolicy(
        app,
        [{ ...policy, include: [...policy.include, extra] }],
        app.domain,
        "expected",
      ),
    );
  assert.throws(() =>
    assertAccessPolicy(
      { ...app, type: "other" },
      [policy],
      app.domain,
      "expected",
    ),
  );
});
