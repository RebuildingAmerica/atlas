import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWebManifest, digestDirectory } from "./web-release.mjs";
import { preserveRuntimeIdentity } from "./web-runtime-identity.mjs";
import { planWebPromotion, promoteWebRelease } from "./web-promote.mjs";

function fixture(t, architecture = "workers") {
  const durable = architecture === "durable";
  if (durable) architecture = "workers";
  const source = mkdtempSync(join(tmpdir(), "atlas-promotion-"));
  t.after(() => rmSync(source, { recursive: true, force: true }));
  mkdirSync(join(source, "artifact"));
  mkdirSync(join(source, "assets"));
  writeFileSync(join(source, "artifact/server.js"), "verified server");
  writeFileSync(join(source, "assets/client.js"), "verified client");
  const runtime = {
    ATLAS_MANAGED: "true",
    ATLAS_MULTI_USER: "true",
    ATLAS_PUBLIC_URL: "https://atlas.example.com",
    ATLAS_AUTH_INTERNAL_SECRET: "existing-secret",
    ATLAS_AUTH_JWT_AUDIENCES: "https://atlas.example.com/mcp",
    DATABASE_URL: "postgres://existing",
    ATLAS_SERVER_API_PROXY_TARGET: "https://api.example.com",
    ATLAS_EMAIL_RESEND_API_KEY: "existing-email",
    ATLAS_AUTH_API_KEY_INTROSPECTION_URL:
      "https://atlas.example.com/api/auth/internal/api-key",
  };
  const sha = "a".repeat(40);
  const candidateRuntime = {
    ...runtime,
    ATLAS_WEB_CANONICAL_URL: runtime.ATLAS_PUBLIC_URL,
    ATLAS_PUBLIC_URL: `https://atlas-${architecture}-staging-aaaaaaaaaaaa.atlas.example.com`,
  };
  const candidate = {
    ...createWebManifest({
      target: "staging",
      architecture,
      ...(architecture === "hybrid"
        ? {
            imageDigest: `registry.example.com/atlas@sha256:${"d".repeat(64)}`,
            originUrl: "https://r-stage---atlas-web-staging-uscentral1.run.app",
            revision: "atlas-web-staging-r-stage",
          }
        : {}),
      releaseSha: sha,
      sourceDirty: false,
      artifactDigest: digestDirectory(join(source, "artifact")),
      assetsDigest: digestDirectory(join(source, "assets")),
      publicEnv: candidateRuntime,
    }),
    candidateUrl: candidateRuntime.ATLAS_PUBLIC_URL,
    workerVersionId: "12345678-1234-1234-1234-123456789abc",
    accountId: "a".repeat(32),
    zoneId: "b".repeat(32),
  };
  candidate.runtimeIdentity = preserveRuntimeIdentity(candidateRuntime, sha);
  writeFileSync(join(source, "manifest.json"), JSON.stringify(candidate));
  writeFileSync(join(source, "deployment.json"), JSON.stringify(candidate));
  writeFileSync(
    join(source, "private-journal.json"),
    JSON.stringify(preserveRuntimeIdentity(candidateRuntime, sha)),
  );
  const now = Date.now();
  const checks = [
    "active-deployment",
    ...[
      "/",
      "/browse",
      "/map",
      "/profiles/people",
      "/profiles/organizations",
      "/sign-in",
    ].map((path) => `page:${path}`),
    "api-health",
    "anonymous-session",
    "catalog:person",
    "profile:person",
    "catalog:organization",
    "profile:organization",
    "documentation",
    "mcp:/mcp",
    "mcp:/mcp/",
    "release-billing",
    "access-denial",
    ...(architecture === "hybrid" ? ["origin-rejection"] : []),
  ].map((name) => ({ name, status: "pass" }));
  const records = Array.from({ length: 301 }, (_, index) => ({
    schemaVersion: 1,
    ...candidate,
    origin: candidate.candidateUrl,
    status: "pass",
    protectedCandidate: true,
    collectedAt: new Date(now - (300 - index) * 300000).toISOString(),
    checks,
  }));
  const zero = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
  const evidence = {
    releaseSha: sha,
    baseline: {
      days: 14,
      windowEnd: new Date(now - 3600000).toISOString(),
      warmP95Ms: 200,
      peakDynamicRequestsPerDay: 100,
    },
    cloudflare: {
      accountId: candidate.accountId,
      plan: "free",
      otherRequestsPerDay: 0,
      otherQueriesPerDay: 0,
    },
    workers: {
      journeysPassed: true,
      limitsPassed: true,
      cpuP99Ms: 7,
      cpuLimitFailures: 0,
      queriesPerDay: 200,
      warmP95Ms: 210,
      coldP95Ms: 1000,
      addedMonthlyCosts: zero([
        "databaseUsd",
        "networkUsd",
        "buildsUsd",
        "storageUsd",
        "logsUsd",
      ]),
    },
    hybrid: {
      journeysPassed: true,
      originProtected: true,
      warmP95Ms: 210,
      coldP95Ms: 1000,
      monthly: zero([
        "cpuSeconds",
        "gibSeconds",
        "requests",
        "egressGiB",
        "storageUsd",
        "buildsUsd",
        "logsUsd",
        "databaseUsd",
      ]),
      freeRemaining: zero([
        "cpuSeconds",
        "gibSeconds",
        "requests",
        "egressGiB",
      ]),
      rates: zero([
        "cpuSecondUsd",
        "gibSecondUsd",
        "millionRequestsUsd",
        "egressGiBUsd",
      ]),
    },
  };
  if (architecture === "hybrid") evidence.workers.cpuP99Ms = 10;
  if (durable) {
    const runtime = (
      workerName,
      namespaceClass,
      artifactDigest = "b".repeat(64),
    ) => ({
      workerName,
      namespaceClass,
      artifactDigest,
      releaseSha: sha,
      workerVersionId: candidate.workerVersionId,
      namespaceId: "c".repeat(32),
      storage: "sqlite",
    });
    const api = runtime("atlas-api", "ApiRuntime");
    const web = runtime(
      candidate.workerName,
      "AtlasAppRuntime",
      candidate.artifactDigest,
    );
    const runtimeReleases = { web, api, discovery: api };
    evidence.releasePolicy = {
      mode: "immediate",
      architecture: "cloudflare-durable",
      releaseSha: sha,
      authorizedBy: "Operator",
      authorizationReference:
        "Operator waived 24h staging and 72h production waits",
      authorizedAt: new Date(now - 1000).toISOString(),
    };
    Object.assign(evidence.cloudflare, {
      collectedAt: new Date(now).toISOString(),
      evidenceReference: "private/account.json",
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
    });
    evidence.durable = {
      journeysPassed: true,
      warmP95Ms: 210,
      coldP95Ms: 1000,
      edgeCpuP99Ms: 1,
      edgeCpuLimitFailures: 0,
      addedMonthlyCosts: evidence.workers.addedMonthlyCosts,
      runtimeReleases,
      rollback: {
        readbackPassed: true,
        evidenceReference: "private/joint-rollback.json",
        runtimeReleases,
      },
      measurements: Object.fromEntries(
        Object.entries(runtimeReleases).map(([key, identity]) => [
          key,
          {
            ...identity,
            provider: "cloudflare",
            evidenceReference: "private/provider.json",
            collectedAt: new Date(now).toISOString(),
            cpuP99Ms: 20,
            knownMemoryLimitBytes: 128 * 1024 * 1024,
            memoryLimitFailures: 0,
            providerLoad: {
              representativePassed: true,
              maxBoundedPayloadPassed: true,
              concurrencyPassed: true,
              scopeReference: "private/load.json",
            },
            peakConnections: 2,
            limitFailures: 0,
            bundleStartupPassed: true,
            maxAlarmWallMs: 1000,
            resumableAlarmsPassed: true,
          },
        ]),
      ),
    };
    Object.assign(
      candidate,
      createWebManifest({
        ...candidate,
        execution: "cloudflare-durable",
        releasePolicy: evidence.releasePolicy,
        runtimeDependencies: { api, discovery: api },
      }),
      { durableNamespaceId: web.namespaceId },
    );
    writeFileSync(join(source, "manifest.json"), JSON.stringify(candidate));
    writeFileSync(join(source, "deployment.json"), JSON.stringify(candidate));
    records.splice(0, records.length - 1);
    Object.assign(records[0], candidate, {
      checks: [...checks, { name: "joint-runtime", status: "pass" }],
    });
    delete evidence.hybrid;
    delete evidence.workers;
  }
  return { source, candidate, runtime, evidence, records, now };
}
test("promotion reuses exact staging artifacts and derives its day of operation from the immutable journal", (t) => {
  const f = fixture(t),
    plan = planWebPromotion(f);
  assert.equal(plan.manifest.target, "production");
  assert.equal(plan.manifest.artifactDigest, f.candidate.artifactDigest);
  assert.equal(plan.manifest.assetsDigest, f.candidate.assetsDigest);
  assert.deepEqual(plan.manifest.buildPublicEnv, f.candidate.buildPublicEnv);
  assert.equal(plan.runtime.ATLAS_PUBLIC_URL, "https://atlas.example.com");
  assert.equal(plan.runtime.ATLAS_AUTH_INTERNAL_SECRET, "existing-secret");
  assert.equal(
    JSON.stringify(plan.manifest).includes("existing-secret"),
    false,
  );
});

for (const architecture of ["workers", "durable"])
  for (const fails of [false, true])
    test(`${architecture} production cutover ${fails ? "automatically restores Vercel after failed probes" : "archives exact artifacts and starts a new production journal"}`, async (t) => {
      const f = fixture(t, architecture),
        directory = join(f.source, "production"),
        calls = [];
      const expected = {
        target: "production",
        hostname: "atlas.example.com",
        owner: "ops@example.com",
        accountId: f.candidate.accountId,
        zoneId: f.candidate.zoneId,
        project: "prj_atlas",
        team: "team_atlas",
      };
      let deployment;
      const options = {
        ...f,
        directory,
        expected,
        token: "private-provider",
        hostedSecret: "existing-verifier",
        capture: async () => {
          calls.push("capture");
          return { dns: "captured", vercel: "retained" };
        },
        publish: async (_directory, target, publishedArchitecture, input) => {
          calls.push("publish");
          assert.equal(target, "production");
          assert.equal(publishedArchitecture, "workers");
          assert.equal(input.promotion.imageDigest, f.candidate.imageDigest);
          assert.equal(
            input.runtime.ATLAS_AUTH_INTERNAL_SECRET,
            f.runtime.ATLAS_AUTH_INTERNAL_SECRET,
          );
          assert.equal(
            input.promotion.workerVersionId,
            f.candidate.workerVersionId,
          );
          const manifest = JSON.parse(
            readFileSync(join(directory, "manifest.json"), "utf8"),
          );
          deployment = {
            ...manifest,
            workerVersionId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
            candidateUrl: `https://${manifest.workerName}.atlas.example.com`,
            accountId: expected.accountId,
            zoneId: expected.zoneId,
            ...(architecture === "durable"
              ? { durableNamespaceId: "d".repeat(32) }
              : {}),
          };
          return deployment;
        },
        rollback: async ({ apply, journal }) => {
          calls.push(apply ? "rollback" : "rollback-doctor");
          assert.match(journal.operationId, /^[a-f0-9]{64}$/);
          return { status: apply ? "routing-restored" : "ready" };
        },
        applyDomains: async ({ domains }) => {
          calls.push("cutover");
          assert.deepEqual(domains, [
            new URL(deployment.candidateUrl).hostname,
            expected.hostname,
          ]);
        },
        cloudflare: () => ({
          name: deployment.workerName,
          references: {
            domains: [
              { hostname: expected.hostname, zone_id: expected.zoneId },
            ],
          },
        }),
        probe: async ({ origin, workerVersionId, clientId }) => {
          calls.push("probe");
          assert.equal(origin, "https://atlas.example.com");
          assert.equal(workerVersionId, deployment.workerVersionId);
          assert.equal(clientId, undefined);
          return { status: fails ? "block" : "pass" };
        },
      };
      if (fails)
        await assert.rejects(
          () => promoteWebRelease(options),
          /Vercel routing was restored/,
        );
      else {
        const result = await promoteWebRelease(options);
        assert.equal(
          result.observationRequiredHours,
          architecture === "durable" ? 0 : 72,
        );
        assert.equal(
          result.observationWindowWaived,
          architecture === "durable",
        );
        assert.deepEqual(
          result.releasePolicy,
          f.evidence.releasePolicy ?? null,
        );
      }
      assert.deepEqual(calls, [
        "capture",
        "publish",
        "rollback-doctor",
        "cutover",
        "probe",
        ...(fails ? ["rollback"] : []),
      ]);
      assert.equal(
        digestDirectory(join(directory, "artifact")),
        f.candidate.artifactDigest,
      );
      assert.equal(
        digestDirectory(join(directory, "assets")),
        f.candidate.assetsDigest,
      );
      const published = JSON.parse(
        readFileSync(join(directory, "deployment.json"), "utf8"),
      );
      assert.equal(published.promotionState, fails ? "rolled-back" : "active");
      assert.equal(
        JSON.stringify(published).includes("existing-secret"),
        false,
      );
    });
test("staging summary flags cannot replace fresh protected probes or preserved credentials", (t) => {
  for (const kind of [
    "gap",
    "version",
    "digest",
    "access",
    "secret",
    "quota",
    "missing-identity",
  ]) {
    const f = fixture(t);
    f.evidence.staging = {
      continuousChecksPassed: true,
      startedAt: new Date(f.now - 90000000).toISOString(),
      lastCheckedAt: new Date(f.now).toISOString(),
    };
    if (kind === "gap") f.records = f.records.slice(-2);
    if (kind === "version")
      f.records[1].workerVersionId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    if (kind === "digest")
      writeFileSync(join(f.source, "assets/client.js"), "modified");
    if (kind === "access")
      f.records.forEach((record) => {
        record.protectedCandidate = false;
      });
    if (kind === "secret") f.runtime.ATLAS_AUTH_INTERNAL_SECRET = "replacement";
    if (kind === "quota") f.evidence.cloudflare.otherRequestsPerDay = 99999;
    if (kind === "missing-identity")
      writeFileSync(
        join(f.source, "deployment.json"),
        JSON.stringify({ ...f.candidate, runtimeIdentity: undefined }),
      );
    assert.throws(() => planWebPromotion(f));
  }
});

test("immediate promotion uses one fresh exact probe and rejects failures, stale samples and changed joint releases", (t) => {
  const f = fixture(t, "durable");
  const plan = planWebPromotion(f);
  assert.equal(plan.staging.windowWaived, true);
  assert.equal(plan.staging.elapsedHours, 0);
  assert.equal(plan.staging.continuousChecksPassed, false);
  assert.equal(plan.staging.currentChecksPassed, true);
  for (const mutate of [
    (x) => {
      x.records = [];
    },
    (x) => {
      x.records[0].status = "fail";
    },
    (x) => {
      x.records[0].checks = x.records[0].checks.filter(
        (row) => row.name !== "joint-runtime",
      );
    },
    (x) => {
      x.records[0].collectedAt = new Date(x.now - 660_000).toISOString();
    },
    (x) => {
      x.records[0].runtimeDependencies = {};
    },
    (x) => {
      x.evidence.durable.runtimeReleases.web.workerVersionId =
        "ffffffff-ffff-ffff-ffff-ffffffffffff";
    },
    (x) => {
      x.evidence.durable.rollback.readbackPassed = false;
    },
    (x) => {
      x.evidence.releasePolicy.authorizationReference = "different waiver";
    },
  ]) {
    const changed = fixture(t, "durable");
    mutate(changed);
    assert.throws(() => planWebPromotion(changed));
  }
});

test("historical Cloud Run passing evidence is not a fallback for a failed Cloudflare release", (t) => {
  assert.throws(
    () => planWebPromotion(fixture(t, "hybrid")),
    /selection gates/,
  );
});
