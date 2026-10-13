import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Linter } from "eslint";
import {
  publicationContext,
  publicationStage,
  publicationSummary,
  preflightPublicationBilling,
  validateRetainedRun,
  releasePath,
  inspectPublicArtifact,
  assemblePublicationSettings,
  retainPrivatePublicationDirectory,
  sealPublication,
  cleanupPrivatePublicationDirectory,
  retainedPublicationRuntime,
  verifyHostedJourneys,
  assertWebApiRuntime,
  verifyPublicationApiRouting,
  hostedFailureLocations,
  hostedFailureReport,
  schemaFailureDiagnostic,
} from "./cloudflare-publication.mjs";
import { assertWebObserverConfiguration } from "./web-observe.mjs";
import { canonicalDigest } from "./api-cloudflare-release.mjs";

const sha = "a".repeat(40);

test("schema failures expose only phase, exception type and SQLSTATE", () => {
  const diagnostic = {
    schemaRelease: "failed",
    phase: "schema-apply",
    errorType: "QueryCanceled",
    sqlstate: "57014",
  };
  assert.deepEqual(
    schemaFailureDiagnostic(JSON.stringify(diagnostic)),
    diagnostic,
  );
  for (const output of [
    "private query",
    JSON.stringify({ ...diagnostic, query: "private SQL" }),
    JSON.stringify({ ...diagnostic, phase: "private host" }),
    JSON.stringify({ ...diagnostic, sqlstate: "private secret" }),
  ]) {
    assert.equal(schemaFailureDiagnostic(output), null);
  }
});

test("real Playwright JSON identifies catalog assertion and timeout boundaries", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-hosted-reporter-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const moduleUrl = new URL(
    "../../app/node_modules/@playwright/test/index.js",
    import.meta.url,
  ).pathname;
  const cli = new URL(
    "../../app/node_modules/@playwright/test/cli.js",
    import.meta.url,
  );
  const reportFile = join(directory, "report.json");
  const configFile = join(directory, "playwright.config.mjs");
  writeFileSync(
    configFile,
    `export default { testDir: ${JSON.stringify(directory)}, timeout: 200, workers: 1 };`,
  );
  writeFileSync(
    join(directory, "catalog-hosted.spec.ts"),
    `
    import { test, expect } from ${JSON.stringify(moduleUrl)};
    test('request assertion', async () => {
      await test.step('public app map', async () => expect(401, 'public app map').toBe(200));
    });
    test('request timeout', async () => {
      await test.step('direct API catalog', async () => new Promise(() => {}));
    });
  `,
  );
  const result = spawnSync(
    process.execPath,
    [
      cli.pathname,
      "test",
      "--config",
      configFile,
      "--reporter=github,json",
      "--output",
      join(directory, "results"),
    ],
    {
      env: { ...process.env, CI: "1", PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const failures = hostedFailureReport(report);
  assert.equal(failures.length, 2, JSON.stringify(report.errors));
  assert.equal(failures[0].kind, "assertion");
  assert.equal(failures[0].steps[0].name, "public app map");
  assert.equal(failures[0].steps[0].httpStatus, 401);
  assert.equal(failures[1].kind, "timeout");
  assert.equal(failures[1].steps[0].name, "direct API catalog");
  assert.equal(failures[1].steps[0].failed, true);
  assert.equal(failures[1].steps[0].unfinished, true);
  assert.equal(failures[1].steps[0].durationMs, null);
});

test("structured hosted failures identify timed-out catalog requests without private output", () => {
  const report = {
    suites: [
      {
        specs: [
          {
            file: "catalog-hosted.spec.ts",
            line: 159,
            column: 3,
            tests: [
              {
                results: [
                  {
                    status: "timedOut",
                    duration: 30001,
                    error: {
                      message: "Bearer private-token customer@example.org",
                    },
                    stdout: [{ text: "private-response" }],
                    steps: [
                      { title: "direct API catalog", duration: 1000 },
                      {
                        title: "public app map",
                        duration: 29000,
                        error: { message: "private-body" },
                      },
                      { title: "customer@example.org", duration: 5, error: {} },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(hostedFailureReport(report), [
    {
      file: "app/tests/e2e/catalog-hosted.spec.ts",
      line: 159,
      column: 3,
      status: "timedOut",
      kind: "timeout",
      durationMs: 30001,
      steps: [
        { name: "direct API catalog", durationMs: 1000, failed: false },
        { name: "public app map", durationMs: 29000, failed: true },
      ],
    },
  ]);
  assert.deepEqual(
    hostedFailureReport({
      suites: [
        { specs: [{ ...report.suites[0].specs[0], file: "secret.env" }] },
      ],
    }),
    [],
  );
});

test("hosted failure diagnostics retain source locations without credentials or response bodies", () => {
  const output = [
    "::error file=/home/runner/work/atlas/atlas/app/tests/e2e/catalog-hosted.spec.ts,line=169,col=5,title=private-customer::Bearer private-token%0Aresponse body",
    "    at /home/runner/work/atlas/atlas/app/tests/e2e/atproto-hosted.spec.ts:68:32",
    "    at /private/secret.env:1:1",
    "::error file=/tmp/secret.json,line=2,col=3::private-input",
  ].join("\n");
  assert.deepEqual(hostedFailureLocations(output), [
    { file: "app/tests/e2e/catalog-hosted.spec.ts", line: 169, column: 5 },
    { file: "app/tests/e2e/atproto-hosted.spec.ts", line: 68, column: 32 },
  ]);
  assert.deepEqual(
    hostedFailureLocations("provider-secret-without-location"),
    [],
  );
});

test("identity helper diagnostics expose only fixed failure categories and HTTP status", () => {
  const report = {
    suites: [
      {
        specs: [
          {
            file: "atproto-identity-hosted.spec.ts",
            line: 65,
            column: 35,
            tests: [
              {
                results: [
                  {
                    status: "failed",
                    duration: 689,
                    error: {
                      message:
                        'Error: {"error":"Hosted E2E cleanup is unavailable."}\nExpected: < 400\nReceived: 503\nBearer private-token customer@example.org',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const failures = hostedFailureReport(report);
  assert.equal(failures[0].httpStatus, 503);
  assert.equal(failures[0].reason, "hosted-cleanup-unavailable");
  assert.equal(JSON.stringify(failures).includes("private-token"), false);
  assert.equal(
    JSON.stringify(failures).includes("customer@example.org"),
    false,
  );
});

test("trusted publication preflight and cleanup work in a clean checkout before dependency setup", (t) => {
  const checkout = mkdtempSync(join(tmpdir(), "atlas-pre-setup-"));
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  cpSync(new URL("./", import.meta.url), join(checkout, "scripts/deploy"), {
    recursive: true,
  });
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "RebuildingAmerica/atlas",
    GITHUB_SHA: sha,
    GITHUB_REF: "refs/tags/v2026.10.12-cf.14",
    ATLAS_PUBLICATION_TARGET: "production",
    ATLAS_PUBLICATION_OPERATION: "doctor",
    CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
    GH_TOKEN: "fixture",
  };
  const preflight = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import {publicationContext} from './scripts/deploy/cloudflare-publication.mjs'; console.log(JSON.stringify(publicationContext(process.env)));",
    ],
    { cwd: checkout, env, encoding: "utf8" },
  );
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.equal(JSON.parse(preflight.stdout).operation, "doctor");
  for (const operation of ["--seal", "--cleanup"]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/deploy/cloudflare-publication.mjs", operation],
      { cwd: checkout, env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
});

test("the normal publication path saves fresh canonical proof without rewriting original routing history", (t) => {
  const bundle = mkdtempSync(join(tmpdir(), "atlas-canonical-publication-"));
  t.after(() => rmSync(bundle, { recursive: true, force: true }));
  const apiDirectory = join(bundle, "api");
  mkdirSync(apiDirectory);
  const identity = {
    releaseSha: sha,
    accountId: "b".repeat(32),
    zoneId: "c".repeat(32),
    publicHostname: "api.example.org",
    operationsHostname: "atlas-api-ops-production.example.org",
    workerName: "atlas-api-ops-production",
    workerVersionId: "22222222-2222-2222-2222-222222222222",
    artifactDigest: "d".repeat(64),
  };
  const manifest = {
    target: "production",
    status: "verified-paused",
    accountId: identity.accountId,
    releaseSha: sha,
    operations: {
      hostname: identity.operationsHostname,
      workerName: identity.workerName,
      workerVersionId: identity.workerVersionId,
      artifactDigest: identity.artifactDigest,
    },
    runtimeReleases: Object.fromEntries(
      ["api", "discovery"].map((role) => [
        role,
        {
          workerName: `atlas-${role}-production`,
          releaseSha: sha,
          workerVersionId: identity.workerVersionId,
          artifactDigest: "e".repeat(64),
          namespaceId: (role === "api" ? "1" : "2").repeat(32),
          namespaceClass: role === "api" ? "ApiRuntime" : "DiscoveryRuntime",
          storage: "sqlite",
        },
      ]),
    ),
  };
  writeFileSync(
    join(apiDirectory, "api-release.json"),
    JSON.stringify(manifest),
  );
  const original = {
    ...identity,
    releaseSha: "f".repeat(40),
    workerVersionId: "11111111-1111-1111-1111-111111111111",
  };
  const snapshot = { ...original, routes: [] };
  const journal = {
    schemaVersion: 1,
    operationId: canonicalDigest(original),
    snapshot,
    snapshotDigest: canonicalDigest(snapshot),
    phase: "verified",
    routeId: "3".repeat(32),
  };
  const journalFile = join(bundle, "api-public-routing.json");
  writeFileSync(journalFile, JSON.stringify(journal));
  const bytesBefore = readFileSync(journalFile);
  const now = Date.parse("2026-10-12T14:00:00Z");
  const receipt = {
    schemaVersion: 1,
    kind: "cloudflare-api-routing-verification",
    status: "verified-canonical",
    ...identity,
    runtimeReleases: manifest.runtimeReleases,
    routeId: journal.routeId,
    routingJournalDigest: canonicalDigest(journal),
    verifiedAt: new Date(now).toISOString(),
  };
  const input = {
    bundle,
    apiDirectory,
    operationsArtifact: join(apiDirectory, "operations"),
    accessFile: join(bundle, "private-access.json"),
    zoneId: identity.zoneId,
    publicHostname: identity.publicHostname,
    operationsHostname: identity.operationsHostname,
    requireCanonical: true,
    now: () => now + 1_000,
    node: () =>
      JSON.stringify({
        ...receipt,
        verifiedAt: new Date(now + 1_000).toISOString(),
      }),
  };
  const expected = {
    ...receipt,
    verifiedAt: new Date(now + 1_000).toISOString(),
  };
  const result = verifyPublicationApiRouting(input);
  assert.deepEqual(result, expected);
  assert.deepEqual(
    JSON.parse(
      readFileSync(join(apiDirectory, "api-routing-verification.json")),
    ),
    expected,
  );
  assert.deepEqual(readFileSync(journalFile), bytesBefore);
  for (const stale of [
    { status: "verified-protected", releaseSha: sha },
    { ...receipt, verifiedAt: new Date(now - 600_001).toISOString() },
  ]) {
    assert.throws(
      () =>
        verifyPublicationApiRouting({
          ...input,
          node: () => JSON.stringify(stale),
        }),
      /canonical/i,
    );
    assert.deepEqual(readFileSync(journalFile), bytesBefore);
  }
});

test("web journeys use the exact verified API pair while discovery can remain paused", () => {
  const runtimeReleases = Object.fromEntries(
    ["api", "discovery"].map((role) => [
      role,
      {
        workerName: `atlas-${role}-production`,
        releaseSha: sha,
        workerVersionId: "11111111-1111-1111-1111-111111111111",
        artifactDigest: "b".repeat(64),
        namespaceId: (role === "api" ? "c" : "d").repeat(32),
        namespaceClass: role === "api" ? "ApiRuntime" : "DiscoveryRuntime",
        storage: "sqlite",
      },
    ]),
  );
  const evidence = {
    durable: { runtimeReleases: structuredClone(runtimeReleases) },
  };
  for (const status of ["verified-active", "verified-paused"]) {
    const api = { status, runtimeReleases };
    assert.doesNotThrow(() => assertWebApiRuntime(api, evidence));
    assert.equal(api.status, status);
    for (const role of ["api", "discovery"]) {
      const changed = structuredClone(evidence);
      changed.durable.runtimeReleases[role].workerVersionId =
        "22222222-2222-2222-2222-222222222222";
      assert.throws(() => assertWebApiRuntime(api, changed), /exact verified/);
    }
  }
  assert.throws(
    () =>
      assertWebApiRuntime({ status: "unverified", runtimeReleases }, evidence),
    /exact verified/,
  );
});

test("deployment and CI JavaScript has no unresolved Node identifiers", () => {
  const linter = new Linter();
  const config = {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: Object.fromEntries(
        Object.getOwnPropertyNames(globalThis).map((name) => [
          name,
          "readonly",
        ]),
      ),
    },
    rules: { "no-undef": "error" },
  };
  for (const directory of ["scripts/deploy", "scripts/ci"]) {
    const root = new URL(`../../${directory}/`, import.meta.url);
    for (const name of readdirSync(root).filter((name) =>
      name.endsWith(".mjs"),
    )) {
      const messages = linter.verify(
        readFileSync(new URL(name, root), "utf8"),
        config,
      );
      assert.deepEqual(
        messages,
        [],
        `${directory}/${name} has unresolved identifiers`,
      );
    }
  }
});

test("configuration success explicitly says nothing was deployed or health checked", () => {
  const summary = publicationSummary({
    env: {
      ATLAS_PUBLICATION_TARGET: "production",
      ATLAS_PUBLICATION_OPERATION: "doctor",
    },
    report: { status: "pass" },
  });
  assert.match(summary, /Production configuration check: passed/);
  assert.match(summary, /Nothing deployed/);
  assert.match(summary, /Production health was not checked/);
});

test("API routing recovery does not claim the previous origin was restored or healthy", () => {
  const summary = publicationSummary({
    env: {
      ATLAS_PUBLICATION_TARGET: "production",
      ATLAS_PUBLICATION_OPERATION: "restore-api",
    },
    report: { status: "verified-operation" },
  });
  assert.match(summary, /Removed the recorded public API Worker route/);
  assert.match(summary, /Previous-origin health was not checked/);
});

test("a rejected retained source is explained before a release artifact exists", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-source-summary-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = "RebuildingAmerica/atlas";
  assert.throws(
    () =>
      validateRetainedRun(
        {
          id: 123,
          path: ".github/workflows/deploy-production.yml",
          head_sha: "b".repeat(40),
          head_branch: "v2026.10.12-1",
          status: "completed",
          conclusion: "success",
          head_repository: { full_name: repository },
        },
        { target: "production", repository, sha, operation: "web-candidate" },
        { runId: "123" },
      ),
    (error) => {
      const summary = publicationSummary({
        env: {
          ATLAS_PUBLICATION_TARGET: "production",
          ATLAS_PUBLICATION_OPERATION: "web-candidate",
        },
        directory,
        failed: true,
        error,
      });
      assert.match(summary, /Retained publication source identity/);
      assert.match(summary, /this release commit/);
      assert.doesNotMatch(summary, /No safe failure/);
      return true;
    },
  );
});

test("unrecognized early failures never expose their provider message", () => {
  const summary = publicationSummary({
    env: {
      ATLAS_PUBLICATION_TARGET: "production",
      ATLAS_PUBLICATION_OPERATION: "web-candidate",
    },
    failed: true,
    error: new Error("private-provider-content"),
  });
  assert.doesNotMatch(summary, /private-provider-content/);
});

test("failure summaries show the current safe boundary without provider content", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-summary-"));
  const env = {
    ATLAS_PUBLICATION_TARGET: "production",
    ATLAS_PUBLICATION_OPERATION: "publish-api",
    GITHUB_RUN_ID: "123",
  };
  try {
    writeFileSync(
      join(directory, "publication.json"),
      JSON.stringify({ runId: "123", operation: "publish-api" }),
    );
    writeFileSync(
      join(directory, "publication-diagnostics.jsonl"),
      JSON.stringify({
        stage: "billing-preflight",
        status: "fail",
        message: "secret-provider-content",
      }) + "\n",
    );
    writeFileSync(
      join(directory, "billing-diagnostics.jsonl"),
      JSON.stringify({
        stage: "catalog-validation",
        status: "fail",
        message: "secret-provider-content",
      }) + "\n",
    );
    const summary = publicationSummary({ env, directory, failed: true });
    assert.match(summary, /publish-api: failed/);
    assert.match(summary, /Stripe catalog validation/);
    assert.match(summary, /Production health is unverified/);
    assert.doesNotMatch(summary, /secret-provider-content/);
    env.GITHUB_RUN_ID = "124";
    assert.doesNotMatch(
      publicationSummary({ env, directory, failed: true }),
      /Stripe catalog validation/,
    );
    env.ATLAS_PUBLICATION_OPERATION = "secret-provider-content";
    assert.doesNotMatch(
      publicationSummary({ env, directory, failed: true }),
      /secret-provider-content/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publication retains only closed stage outcomes when a provider fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-stage-"));
  try {
    assert.equal(
      publicationStage(directory, "billing-preflight", () => 42),
      42,
    );
    const failure = new Error(
      "private-credential customer-private@example.org",
    );
    assert.throws(
      () =>
        publicationStage(directory, "evidence-validation", () => {
          throw failure;
        }),
      (error) => error === failure,
    );
    const retained = readFileSync(
      join(directory, "publication-diagnostics.jsonl"),
      "utf8",
    );
    assert.deepEqual(retained.trim().split("\n").map(JSON.parse), [
      { stage: "billing-preflight", status: "running" },
      { stage: "billing-preflight", status: "pass" },
      { stage: "evidence-validation", status: "running" },
      { stage: "evidence-validation", status: "fail" },
    ]);
    assert.doesNotMatch(retained, /private-credential|customer-private/);
    assert.throws(
      () => publicationStage(directory, failure.message, () => {}),
      /Unknown publication stage/,
    );
    assert.equal(
      readFileSync(join(directory, "publication-diagnostics.jsonl"), "utf8"),
      retained,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("API failure summaries identify the current nested check and ignore retained predecessor failures", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-api-summary-"));
  const env = {
    ATLAS_PUBLICATION_TARGET: "production",
    ATLAS_PUBLICATION_OPERATION: "verify-api",
    GITHUB_RUN_ID: "124",
  };
  const apiDirectory = "api/publication-123";
  try {
    mkdirSync(join(directory, apiDirectory), { recursive: true });
    writeFileSync(
      join(directory, "publication.json"),
      JSON.stringify({
        runId: "124",
        operation: "verify-api",
        apiDirectory,
      }),
    );
    assert.throws(
      () =>
        publicationStage(directory, "api-verify", () => {
          throw Error("private-provider-output");
        }),
      /private-provider-output/,
    );
    const diagnosticFile = join(
      directory,
      apiDirectory,
      "verification-diagnostics.jsonl",
    );
    const records = [
      { runId: "123", stage: "runtime-snapshot", status: "failed" },
      { runId: "124", stage: "api-probes", status: "pass" },
      {
        runId: "124",
        stage: "runtime-deployments-after",
        status: "failed",
        message: "private-provider-output",
      },
      { runId: "124", stage: "runtime-verification", status: "failed" },
    ];
    writeFileSync(
      diagnosticFile,
      records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
    const summary = publicationSummary({ env, directory, failed: true });
    assert.match(summary, /Active API\/discovery versions after probes/);
    assert.doesNotMatch(
      summary,
      /private-provider-output|runtime-snapshot|No safe failure/,
    );
    writeFileSync(diagnosticFile, JSON.stringify(records[0]) + "\n");
    assert.match(
      publicationSummary({ env, directory, failed: true }),
      /API\/discovery runtime verification/,
    );
    assert.doesNotMatch(
      publicationSummary({ env, directory, failed: true }),
      /Rollback snapshot/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("web preparation failures identify the action without retaining private output", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-web-stage-"));
  const env = {
    ATLAS_PUBLICATION_TARGET: "production",
    ATLAS_PUBLICATION_OPERATION: "web-candidate",
    GITHUB_RUN_ID: "123",
  };
  try {
    writeFileSync(
      join(directory, "publication.json"),
      JSON.stringify({
        runId: "123",
        operation: "web-candidate",
      }),
    );
    for (const [stage, label] of [
      ["web-runtime-identity", "Exact API and discovery runtime identity"],
      ["web-runtime-prepare", "Protected web runtime preparation"],
      ["web-build", "Workers application build"],
      ["web-auth-migration", "Authentication database release migration"],
      ["web-artifact-copy", "Web release artifact preparation"],
      ["web-publish", "Protected web Worker publication"],
      ["web-archive", "Immutable web release archive"],
      ["web-observe", "Deployed web runtime observation"],
      ["web-hosted-journeys", "Hosted sign-in, workspace and billing checks"],
    ]) {
      writeFileSync(join(directory, "publication-diagnostics.jsonl"), "");
      const failure = new Error(
        "private-provider-response customer@example.org",
      );
      assert.throws(
        () =>
          publicationStage(directory, stage, () => {
            throw failure;
          }),
        (error) => error === failure,
      );
      const summary = publicationSummary({ env, directory, failed: true });
      assert.ok(summary.includes(label), summary);
      assert.doesNotMatch(
        summary,
        /private-provider-response|customer@example/,
      );
      assert.deepEqual(
        readFileSync(join(directory, "publication-diagnostics.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse),
        [
          { stage, status: "running" },
          { stage, status: "fail" },
        ],
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
const environment = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "RebuildingAmerica/atlas",
  GITHUB_SHA: sha,
  GITHUB_REF: "refs/tags/v2026.10.11-1",
  ATLAS_PUBLICATION_TARGET: "production",
  ATLAS_PUBLICATION_OPERATION: "publish-api",
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_API_TOKEN: "existing-ci-token",
  GH_TOKEN: "existing-workflow-token",
};

test("individual CI settings preserve accounts, PDS, billing and separate API credentials", () => {
  const env = Object.fromEntries(
    [
      "DATABASE_URL",
      "ATLAS_AUTH_INTERNAL_SECRET",
      "ATLAS_AUTH_CALLBACK_SECRET",
      "ATLAS_EDGE_ORIGIN_SECRET",
      "ATLAS_EMAIL_RESEND_API_KEY",
      "ATLAS_HOSTED_E2E_SECRET",
      "ATLAS_PDS_INVITE_BROKER_SECRET",
      "ATLAS_INSTANCE_OPERATOR_EMAILS",
      "ATLAS_PLATFORM_OPERATOR_EMAILS",
      "ATLAS_ADMIN_SIGNING_PUBLIC_KEY",
      "ATLAS_ACCESS_TEAM_DOMAIN",
      "ATLAS_ACCESS_AUD",
      "ANTHROPIC_API_KEY",
      "GCP_SERVICE_ACCOUNT",
    ].map((key) => [key, `fixture-${key.toLowerCase()}`]),
  );
  Object.assign(env, {
    ATLAS_PUBLIC_URL: "https://atlas.example.org",
    ATLAS_API_URL: "https://api.example.org",
    ATLAS_ADMIN_PUBLIC_URL: "https://admin.example.org",
    ATLAS_PDS_PUBLIC_URL: "https://pds.example.org",
    ATLAS_PDS_INVITE_BROKER_URL: "https://pds.example.org/_atlas/pds/invites",
    ATLAS_BILLING_CHECKOUT_ENABLED: "false",
    ATLAS_BILLING_AUTOMATIC_TAX: "true",
    ATLAS_PAID_ACCESS_MODE: "waitlist",
    GCP_SERVICE_ACCOUNT: "atlas-deploy@fixture-project.iam.gserviceaccount.com",
    ATLAS_SAML_SP_PRIVATE_KEY: "fixture-existing-enterprise-key",
  });
  const { runtime, service } = assemblePublicationSettings(env);
  assert.equal(
    runtime.ATLAS_PDS_INVITE_BROKER_SECRET,
    env.ATLAS_PDS_INVITE_BROKER_SECRET,
  );
  assert.equal(
    runtime.ATLAS_SAML_SP_PRIVATE_KEY,
    env.ATLAS_SAML_SP_PRIVATE_KEY,
  );
  assert.equal(
    runtime.ATLAS_AUTH_JWT_AUDIENCES,
    "https://atlas.example.org/mcp,https://api.example.org",
  );
  const api = Object.fromEntries(
    service.spec.template.spec.containers[0].env.map(({ name, value }) => [
      name,
      value,
    ]),
  );
  assert.equal(
    api.ATLAS_AUTH_CALLBACK_SECRET,
    runtime.ATLAS_AUTH_CALLBACK_SECRET,
  );
  assert.equal(api.DATABASE_URL, runtime.DATABASE_URL);
  assert.equal(Object.hasOwn(api, "ATLAS_AUTH_INTERNAL_SECRET"), false);
  assert.equal(
    JSON.parse(api.ATLAS_MACHINE_TRUSTED_ISSUERS)[0].service_account,
    "atlas-scheduler@fixture-project.iam.gserviceaccount.com",
  );
  assert.throws(
    () =>
      assemblePublicationSettings({
        ...env,
        ATLAS_PDS_INVITE_BROKER_SECRET: "",
      }),
    /ATLAS_PDS_INVITE_BROKER_SECRET/,
  );
});

test("production publication requires a release tag and explicit existing CI credentials", () => {
  assert.equal(publicationContext(environment).target, "production");
  for (const patch of [
    { GITHUB_REF: "refs/heads/chore/cloudflare-production-recovery" },
    { CLOUDFLARE_API_TOKEN: "" },
    { GH_TOKEN: "" },
    { GITHUB_ACTIONS: "false" },
  ])
    assert.throws(() => publicationContext({ ...environment, ...patch }));
});

test("artifact paths cannot escape their retained root or follow a symbolic link", () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-publication-path-"));
  try {
    assert.equal(releasePath(root, "api/release"), join(root, "api/release"));
    assert.throws(() => releasePath(root, "../outside"));
    assert.throws(() => releasePath(root, root));
    symlinkSync(tmpdir(), join(root, "linked"));
    assert.throws(() => releasePath(root, "linked/file"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retention rejects raw or JSON-escaped credentials and symbolic links", () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-publication-secrets-"));
  const credential = 'fixture-only-credential-"with-quotes';
  try {
    writeFileSync(
      join(root, "journal.json"),
      JSON.stringify({ value: credential }),
    );
    assert.throws(
      () => inspectPublicArtifact(root, [credential]),
      /credential/,
    );
    writeFileSync(
      join(root, "journal.json"),
      JSON.stringify({ status: "verified-paused" }),
    );
    assert.doesNotThrow(() => inspectPublicArtifact(root, [credential]));
    symlinkSync(tmpdir(), join(root, "linked"));
    assert.throws(() => inspectPublicArtifact(root, []), /symbolic/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime captured from the retained host remains private through sealing and is then removed", (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-publication-retention-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const githubEnv = join(root, "github-env");
  writeFileSync(githubEnv, "");
  const env = { RUNNER_TEMP: root, GITHUB_ENV: githubEnv };
  const directory = retainPrivatePublicationDirectory(env);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(
    readFileSync(githubEnv, "utf8"),
    `ATLAS_PUBLICATION_PRIVATE_DIRECTORY=${directory}\n`,
  );
  const credential = "fixture-provider-only-enterprise-value";
  writeFileSync(
    join(directory, "runtime.json"),
    JSON.stringify({ ATLAS_SAML_SP_PRIVATE_KEY: credential }),
    { mode: 0o600 },
  );
  const bundle = join(root, "bundle");
  mkdirSync(bundle);
  writeFileSync(
    join(directory, "access.json"),
    JSON.stringify({ client_secret: "fixture-access-only-value" }),
    { mode: 0o600 },
  );
  // The next workflow process has only the path, not values copied into its environment.
  const next = { ...env, ATLAS_PUBLICATION_PRIVATE_DIRECTORY: directory };
  assert.equal(readFileSync(githubEnv, "utf8").includes(credential), false);
  writeFileSync(
    join(bundle, "receipt.json"),
    JSON.stringify({ accidental: credential }),
  );
  assert.throws(() => sealPublication(bundle, next), /credential/);
  writeFileSync(
    join(bundle, "receipt.json"),
    JSON.stringify({ accidental: "fixture-access-only-value" }),
  );
  assert.throws(() => sealPublication(bundle, next), /credential/);
  writeFileSync(
    join(bundle, "receipt.json"),
    JSON.stringify({ status: "verified" }),
  );
  assert.equal(sealPublication(bundle, next).status, "safe-to-retain");
  assert.equal(existsSync(directory), true);
  cleanupPrivatePublicationDirectory(next);
  assert.equal(existsSync(directory), false);
  assert.throws(
    () =>
      cleanupPrivatePublicationDirectory({
        ...next,
        ATLAS_PUBLICATION_PRIVATE_DIRECTORY: root,
      }),
    /private/,
  );
});

test("a prerequisite failure before publication has no bundle to scan or upload", (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-publication-not-started-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = join(root, "absent-bundle");
  assert.deepEqual(sealPublication(bundle, {}), {
    status: "nothing-to-retain",
  });
  assert.equal(existsSync(bundle), false);
});

function existingPublicationRuntime() {
  return {
    ATLAS_PUBLIC_URL: "https://atlas.example.org",
    ATLAS_MANAGED: "true",
    ATLAS_MULTI_USER: "true",
    ATLAS_AUTH_JWT_AUDIENCES: "https://atlas.example.org/mcp",
    ATLAS_AUTH_MEMBERSHIP_URL:
      "https://atlas.example.org/api/auth/internal/membership",
    ATLAS_INSTANCE_OPERATOR_EMAILS: "operator@example.org",
    ATLAS_PLATFORM_OPERATOR_EMAILS: "operator@example.org",
    DATABASE_BACKEND: "postgres",
    ATLAS_DEPLOY_MODE: "production",
    ATLAS_AUTH_BASE_PATH: "/api/auth",
    ATLAS_AUTH_API_KEY_INTROSPECTION_URL:
      "https://atlas.example.org/api/auth/internal/api-key",
    ATLAS_SERVER_API_PROXY_TARGET: "https://api.example.org",
    ATLAS_DOCS_URL: "https://docs.example.org",
    ATLAS_EMAIL_FROM: "Atlas <hello@example.org>",
    ATLAS_EMAIL_PROVIDER: "resend",
    ATLAS_PDS_PUBLIC_URL: "https://pds.example.org",
    ATLAS_AUTH_INTERNAL_SECRET: "fixture-internal-signing",
    ATLAS_AUTH_CALLBACK_SECRET: "fixture-api-callback",
    ATLAS_EDGE_ORIGIN_SECRET: "fixture-visitor-proof",
    ATLAS_ADMIN_PUBLIC_URL: "https://admin.example.org",
    DATABASE_URL: "postgres://fixture@db.example.org/atlas",
    ATLAS_EMAIL_RESEND_API_KEY: "fixture-email-key",
    ATLAS_SAML_SP_PRIVATE_KEY: "fixture-existing-enterprise-value",
    ATLAS_HOSTED_E2E_SECRET: "fixture-hosted-verifier",
    ATLAS_HOSTED_E2E_ENABLED: "1",
    ATLAS_HOSTED_E2E_PRODUCTION_ENABLED: "1",
  };
}

test("publication runtime preserves existing GitHub-held identity and SSO without Vercel credentials", async () => {
  const existing = existingPublicationRuntime();
  const result = await retainedPublicationRuntime({
    ...existing,
    GH_TOKEN: "fixture-provider-token-not-application-config",
  });
  assert.deepEqual(result, existing);
  assert.doesNotThrow(() =>
    assertWebObserverConfiguration(result, {
      clientId: "fixture-access-id",
      clientSecret: "fixture-access-secret",
      hostedSecret: existing.ATLAS_HOSTED_E2E_SECRET,
    }),
  );
});

test("publication runtime rejects missing GitHub settings instead of recovering them from Vercel", async () => {
  const existing = existingPublicationRuntime();
  delete existing.DATABASE_URL;
  await assert.rejects(
    retainedPublicationRuntime({
      ...existing,
      VERCEL_TOKEN: "fixture-unused-provider-token",
    }),
    /Runtime DATABASE_URL is required/,
  );
});

test("publication runtime accepts its existing complete secret-store export", async () => {
  const existing = existingPublicationRuntime();
  assert.deepEqual(
    await retainedPublicationRuntime({
      ATLAS_WEB_RUNTIME_ENV_JSON: JSON.stringify(existing),
    }),
    existing,
  );
});

test("hosted journeys verify PDS before smoke, identity and checkout against the exact candidate", () => {
  const calls = [],
    deployment = {
      candidateUrl: "https://candidate.atlas.example.org",
      workerName: "atlas-web",
      workerVersionId: "existing-version",
    };
  const runtime = {
    ATLAS_PUBLIC_URL: "https://atlas.example.org",
    ATLAS_SERVER_API_PROXY_TARGET: "https://api.example.org",
    ATLAS_PDS_PUBLIC_URL: "https://pds.example.org",
    ATLAS_HOSTED_E2E_SECRET: "fixture-hosted-secret",
    ATLAS_BILLING_CHECKOUT_ENABLED: "true",
  };
  const options = {
    deployment,
    runtime,
    env: { GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" },
    releaseSha: sha,
    run: (command, args, { env }) =>
      calls.push({
        command: args.find((arg) => arg.startsWith("test:hosted-")),
        env,
      }),
    node: (command, args, { env }) => calls.push({ command: args.at(-1), env }),
  };
  assert.equal(verifyHostedJourneys(options).status, "pass");
  assert.deepEqual(
    calls.map((c) => c.command),
    [
      "health",
      "invite-broker-route",
      "test:hosted-smoke",
      "test:hosted-identity",
      "test:hosted-checkout",
    ],
  );
  assert.equal(
    calls[2].env.ATLAS_HOSTED_EXPECTED_PUBLIC_URL,
    runtime.ATLAS_PUBLIC_URL,
  );
  assert.equal(
    calls[3].env.ATLAS_HOSTED_EXPECTED_PUBLIC_URL,
    deployment.candidateUrl,
  );
  assert.ok(
    calls.every(
      (c) =>
        c.env.ATLAS_HOSTED_API_URL === runtime.ATLAS_SERVER_API_PROXY_TARGET,
    ),
  );
  assert.ok(
    calls.every(
      (c) => c.env.ATLAS_HOSTED_E2E_SECRET === runtime.ATLAS_HOSTED_E2E_SECRET,
    ),
  );
  assert.ok(
    calls.every(
      (c) => c.env.ATLAS_HOSTED_PDS_URL === runtime.ATLAS_PDS_PUBLIC_URL,
    ),
  );
  assert.throws(
    () =>
      verifyHostedJourneys({
        ...options,
        node: () => {
          throw Error("PDS unavailable");
        },
      }),
    /PDS unavailable/,
  );
  assert.equal(calls.length, 5);
  assert.ok(calls.every((c) => c.env.ATLAS_HOSTED_EXPECT_CATALOG === "true"));
});

test("staging uses trusted main or release tags and has no public promotion operation", () => {
  assert.equal(
    publicationContext({
      ...environment,
      ATLAS_PUBLICATION_TARGET: "staging",
      GITHUB_REF: "refs/heads/main",
    }).target,
    "staging",
  );
  assert.throws(() =>
    publicationContext({
      ...environment,
      ATLAS_PUBLICATION_TARGET: "staging",
      ATLAS_PUBLICATION_OPERATION: "promote-web",
    }),
  );
});

test("web promotion requires an explicit retained Cloudflare rollback run", () => {
  const promote = {
    ...environment,
    ATLAS_PUBLICATION_OPERATION: "promote-web",
    VERCEL_TOKEN: "obsolete-provider-token",
    VERCEL_OWNER: "deleted-team-project",
    VERCEL_PROJECT_ID: "deleted-project",
    VERCEL_ORG_ID: "retained-team",
  };
  for (const runId of [undefined, "", "not-a-run", "123/456"])
    assert.throws(
      () =>
        publicationContext({
          ...promote,
          ATLAS_PUBLICATION_ROLLBACK_RUN_ID: runId,
        }),
      /Web promotion requires an explicit numeric Cloudflare rollback run ID/,
    );
  assert.equal(
    publicationContext({ ...promote, ATLAS_PUBLICATION_ROLLBACK_RUN_ID: "123" })
      .operation,
    "promote-web",
  );
  assert.doesNotThrow(() =>
    publicationContext({
      ...environment,
      ATLAS_PUBLICATION_OPERATION: "promote-web",
      ATLAS_PUBLICATION_ROLLBACK_RUN_ID: "123",
    }),
  );
});

test("retained artifacts come only from this repository's trusted publication workflow", () => {
  const context = publicationContext(environment);
  const run = {
    id: 123,
    path: ".github/workflows/deploy-production.yml",
    head_sha: sha,
    head_branch: "v2026.10.11-1",
    status: "completed",
    conclusion: "success",
    head_repository: { full_name: "RebuildingAmerica/atlas" },
  };
  assert.equal(
    validateRetainedRun(run, context, { runId: "123" }).head_sha,
    sha,
  );
  for (const patch of [
    { head_sha: "c".repeat(40) },
    { path: ".github/workflows/ci.yml" },
    { conclusion: "failure" },
    { head_branch: "chore/unsafe" },
    { head_repository: { full_name: "another/atlas" } },
  ])
    assert.throws(() =>
      validateRetainedRun({ ...run, ...patch }, context, { runId: "123" }),
    );
  assert.doesNotThrow(() =>
    validateRetainedRun({ ...run, conclusion: "failure" }, context, {
      runId: "123",
      recovery: true,
    }),
  );
  assert.doesNotThrow(() =>
    validateRetainedRun({ ...run, head_sha: "c".repeat(40) }, context, {
      runId: "123",
      previous: true,
    }),
  );
  const olderFailure = {
    ...run,
    head_sha: "c".repeat(40),
    conclusion: "failure",
  };
  const verification = { ...context, operation: "verify-api" };
  assert.doesNotThrow(() =>
    validateRetainedRun(olderFailure, verification, {
      runId: "123",
      recovery: true,
    }),
  );
  for (const operation of [
    "activate-api",
    "pause-api",
    "web-candidate",
    "promote-api",
    "promote-web",
  ])
    assert.throws(() =>
      validateRetainedRun(
        olderFailure,
        { ...context, operation },
        {
          runId: "123",
          recovery: true,
        },
      ),
    );
  for (const patch of [
    { head_repository: { full_name: "another/atlas" } },
    { path: ".github/workflows/ci.yml" },
    { status: "in_progress" },
    { head_branch: "chore/unsafe" },
  ])
    assert.throws(() =>
      validateRetainedRun({ ...olderFailure, ...patch }, verification, {
        runId: "123",
        recovery: true,
      }),
    );
});

// A billing outage must not prevent protected paused evaluation or rollback.
// Conversely, no traffic or background consumer may be activated without it.
test("paused publication avoids billing while every activation and promotion verifies it", () => {
  const unavailable = () => {
    throw new Error("fixture billing unavailable");
  };
  for (const operation of [
    "verify-api",
    "pause-api",
    "restore-api",
    "restore-routing",
    "doctor",
  ]) {
    assert.doesNotThrow(() =>
      preflightPublicationBilling(
        { target: "production", operation },
        unavailable,
      ),
    );
  }
  for (const operation of [
    "publish-api",
    "activate-api",
    "promote-api",
    "web-candidate",
    "promote-web",
  ]) {
    assert.throws(
      () =>
        preflightPublicationBilling(
          { target: "production", operation },
          unavailable,
        ),
      /fixture billing unavailable/,
    );
  }
  assert.doesNotThrow(() =>
    preflightPublicationBilling(
      { target: "staging", operation: "web-candidate" },
      unavailable,
    ),
  );
});

test("only first bootstrap with absent production runtimes can defer billing", () => {
  const context = { target: "production", operation: "publish-api" };
  const unavailable = () => {
    throw new Error("fixture billing unavailable");
  };
  const firstBootstrap = { firstBootstrap: true, cloudflare: () => [] };
  assert.doesNotThrow(() =>
    preflightPublicationBilling(context, unavailable, firstBootstrap),
  );
  for (const name of [
    "atlas-api-production",
    "atlas-discovery-production",
    "atlas-api-ops-production",
  ]) {
    assert.throws(
      () =>
        preflightPublicationBilling(context, unavailable, {
          ...firstBootstrap,
          cloudflare: () => [{ name }],
        }),
      /fixture billing unavailable/,
    );
  }
  assert.throws(
    () =>
      preflightPublicationBilling(context, unavailable, {
        ...firstBootstrap,
        cloudflare: () => ({ error: "unreadable" }),
      }),
    /isolation/,
  );
});

test("asynchronous publication stages retain the actual completion boundary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-stage-async-"));
  try {
    assert.equal(
      await publicationStage(
        directory,
        "web-callback-configuration",
        async () => "complete",
      ),
      "complete",
    );
    await assert.rejects(
      publicationStage(directory, "web-callback-configuration", async () => {
        throw Error("private provider output");
      }),
    );
    const records = readFileSync(
      join(directory, "publication-diagnostics.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      records.map((item) => item.status),
      ["running", "pass", "running", "fail"],
    );
    assert.doesNotMatch(JSON.stringify(records), /private provider/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
