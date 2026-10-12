#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBuildOutput } from "@cloudflare/build-output-utils";
import { cloudflareCommand } from "./cloudflare-cli.mjs";
import { preparePythonOutput } from "./api-cloudflare-output.mjs";
import {
  assertAccessPolicy,
  assertCandidateDomain,
  loadWebRuntime,
} from "./web-candidate.mjs";
import { digestDirectory } from "./web-release.mjs";
import {
  runtimeReleaseIdentity,
  assertRuntimeDeployments,
} from "./web-assess.mjs";
import {
  captureApiRuntimeSnapshot,
  createApiRollbackPlan,
} from "./api-runtime-rollback.mjs";

export function validateRuntimeDatabase(hyperdrive, databaseUrl) {
  const database = new URL(databaseUrl);
  if (
    hyperdrive.caching?.disabled !== true ||
    hyperdrive.origin?.host !== database.hostname ||
    hyperdrive.origin?.database !==
      decodeURIComponent(database.pathname.slice(1)) ||
    hyperdrive.origin?.user !== decodeURIComponent(database.username) ||
    hyperdrive.origin?.port !== Number(database.port || 5432)
  )
    throw new Error(
      "Existing PostgreSQL identity and disabled query caching must match.",
    );
}

const ROOT = resolve(import.meta.dirname, "../..");
const ROLES = ["discovery", "api"];
const SHA = /^[a-f0-9]{40}$/,
  DIGEST = /^[a-f0-9]{64}$/;
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const sort = (value) =>
  Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sort(value[key])]),
        )
      : value;
export const canonicalDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(sort(value)))
    .digest("hex");
export const releaseMessage = (target, role, artifactDigest, schemaDigest) =>
  `Atlas ${target} ${role}; artifact=${artifactDigest}; schema=${schemaDigest}; consumers paused`;
const roleClass = (role) =>
  role === "api" ? "ApiRuntime" : "DiscoveryRuntime";

/** Retain the failing read-only check without copying provider errors or credentials. */
export async function runPausedVerificationStage(stage, operation, checkpoint) {
  if (
    ![
      "operations-access",
      "operations-domain",
      "operations-denial",
      "runtime-verification",
      "discovery-version",
      "api-version",
      "runtime-deployments-before",
      "discovery-probes",
      "api-probes",
      "runtime-deployments-after",
      "runtime-snapshot",
    ].includes(stage)
  )
    throw Error("Unknown paused verification stage.");
  await checkpoint({ stage, status: "running" });
  let result;
  try {
    result = await operation();
  } catch {
    await checkpoint({ stage, status: "failed" });
    throw Error(
      `Paused release verification failed at ${stage}; private diagnostics suppressed.`,
    );
  }
  await checkpoint({ stage, status: "pass" });
  return result;
}
function activeVersion(result) {
  const versions = result?.deployments?.[0]?.versions;
  if (
    versions?.length !== 1 ||
    versions[0].percentage !== 100 ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      versions[0].version_id ?? "",
    )
  )
    throw Error("One exact active runtime version is required.");
  return versions[0].version_id;
}
function checkedSchema(result, releaseSha) {
  const r = result?.receipt;
  if (
    result?.status !== "ready" ||
    r?.kind !== "atlas-postgres-schema-release" ||
    r.schemaVersion !== 1 ||
    r.releaseSha !== releaseSha ||
    ![
      "schemaDigest",
      "migrationSourcesDigest",
      "databaseIdentityDigest",
      "catalogDigest",
    ].every((key) => DIGEST.test(r[key] ?? "")) ||
    !Number.isFinite(Date.parse(r.completedAt)) ||
    result.receiptDigest !== canonicalDigest(r)
  )
    throw Error(
      "An exact read-only schema doctor receipt for this release is required.",
    );
  return result.receiptDigest;
}
function checkedProvenance(p) {
  if (
    !p ||
    !String(p.nativeRunId ?? "").match(/^\d+$/) ||
    !SHA.test(p.nativeBuildSha ?? "") ||
    ![
      "nativeProvenanceDigest",
      "packageProvenanceDigest",
      "coreSha256",
      "packagesSha256",
    ].every((k) => DIGEST.test(p[k] ?? ""))
  )
    throw Error("Verified current package/native provenance is required.");
  return Object.fromEntries(
    [
      "nativeRunId",
      "nativeBuildSha",
      "nativeProvenanceDigest",
      "packageProvenanceDigest",
      "coreSha256",
      "packagesSha256",
    ].map((k) => [k, p[k]]),
  );
}
function checkedArtifacts(
  artifacts,
  { target, releaseSha, accountId, schemaReceiptDigest, allowSeedApi = false },
) {
  return Object.fromEntries(
    ROLES.map((role) => {
      const a = artifacts?.[role],
        out = join(a?.directory ?? "", ".cloudflare/output/v0");
      if (
        !DIGEST.test(a?.artifactDigest ?? "") ||
        digestDirectory(out) !== a.artifactDigest
      )
        throw Error("The retained runtime artifact digest differs.");
      const root = json(join(out, "config.json")),
        c = json(join(out, "workers/default/worker.config.json"));
      if (
        root.accountId !== accountId ||
        c.name !== `atlas-${role}-${target}` ||
        c.workersDev !== false ||
        c.previewUrls !== false ||
        (c.domains?.length ?? 0) !== 0 ||
        c.manifest?.mainModule !==
          (role === "api"
            ? "production_entry.py"
            : "production_discovery.py") ||
        c.exports?.[roleClass(role)]?.storage !== "sqlite" ||
        c.env?.ATLAS_RELEASE_SHA?.value !== releaseSha ||
        c.env?.ATLAS_ACTIVE_RELEASE_SHA?.type !== "text" ||
        c.env?.ATLAS_ACTIVE_RELEASE_SHA?.value !== "" ||
        c.env?.ATLAS_SCHEMA_RECEIPT_DIGEST?.value !== schemaReceiptDigest ||
        c.env?.HYPERDRIVE?.type !== "hyperdrive" ||
        !/^[a-f0-9]{32}$/.test(c.env?.HYPERDRIVE?.id ?? "") ||
        JSON.stringify(c.env?.ATLAS_API_SETTINGS) !==
          JSON.stringify({ type: "secret" }) ||
        c.env?.API_RUNTIME?.worker !== `atlas-api-${target}` ||
        c.env?.API_RUNTIME?.exportName !== "ApiRuntime" ||
        (!(allowSeedApi && role === "api") &&
          (c.env?.DISCOVERY_RUNTIME?.worker !== `atlas-discovery-${target}` ||
            c.env?.DISCOVERY_RUNTIME?.exportName !== "DiscoveryRuntime"))
      )
        throw Error(
          "The production artifact account, role, schema or routing contract differs.",
        );
      return [
        role,
        { directory: a.directory, artifactDigest: a.artifactDigest },
      ];
    }),
  );
}
function readRuntimeIdentity(
  role,
  artifact,
  { target, releaseSha, schemaReceiptDigest, cf },
) {
  const workerName = `atlas-${role}-${target}`,
    workerVersionId = activeVersion(
      cf(["workers", "deployments", "list", "--worker", workerName]),
    );
  const v = cf([
    "workers",
    "versions",
    "get",
    workerVersionId,
    "--worker-id",
    workerName,
  ]);
  if (
    v?.id !== workerVersionId ||
    v.annotations?.["workers/tag"] !== releaseSha ||
    v.annotations?.["workers/message"] !==
      releaseMessage(target, role, artifact.artifactDigest, schemaReceiptDigest)
  )
    throw Error("Exact uploaded version/tag/artifact/schema readback failed.");
  const namespaces = cf(["durable-objects", "namespaces", "list"]);
  const matches = Array.isArray(namespaces)
    ? namespaces.filter(
        (n) =>
          n.script === workerName &&
          n.class === roleClass(role) &&
          n.use_sqlite === true,
      )
    : [];
  if (matches.length !== 1)
    throw Error("Exact SQLite namespace readback failed.");
  return runtimeReleaseIdentity({
    workerName,
    workerVersionId,
    releaseSha,
    artifactDigest: artifact.artifactDigest,
    namespaceId: matches[0].id,
    namespaceClass: roleClass(role),
    storage: "sqlite",
  });
}
async function probeRole(probe, role, releaseSha, schemaReceiptDigest) {
  const checks = [];
  for (const path of ["/__atlas/release", "/__atlas/consumers", "/health"]) {
    let r;
    try {
      r = await probe({ role, path, releaseSha });
    } catch {
      throw Error(
        "A real protected runtime probe failed; diagnostics suppressed.",
      );
    }
    if (r?.status !== 200)
      throw Error("A real protected runtime probe failed.");
    if (
      path === "/__atlas/release" &&
      (r.body?.releaseSha !== releaseSha ||
        r.body?.runtimeRole !== role ||
        r.body?.schemaReceiptDigest !== schemaReceiptDigest)
    )
      throw Error("Hosted runtime release identity differs.");
    if (
      path === "/__atlas/consumers" &&
      (r.body?.releaseSha !== releaseSha ||
        r.body?.activeReleaseSha !== "" ||
        r.body?.enabled !== false)
    )
      throw Error(
        "Runtime consumers must remain paused throughout publication.",
      );
    checks.push({ role, path, status: "pass" });
  }
  return checks;
}

/** Publish a paused API/discovery pair. This never activates consumers or web routes. */
export async function publishApiRelease({
  target,
  releaseSha,
  accountId,
  env = process.env,
  schemaResult,
  provenance,
  artifacts,
  bootstrapArtifact,
  previous,
  bootstrap = false,
  cloudflare,
  deploy,
  probe,
  checkpoint,
  now = Date.now,
  apply = false,
}) {
  if (
    !["staging", "production"].includes(target) ||
    !SHA.test(releaseSha ?? "") ||
    !/^[a-f0-9]{32}$/.test(accountId ?? "") ||
    env.CLOUDFLARE_ACCOUNT_ID !== accountId ||
    !env.CLOUDFLARE_API_TOKEN?.trim()
  )
    throw Error(
      "An exact target/commit/account and an in-memory Cloudflare token session are required.",
    );
  const schemaReceiptDigest = checkedSchema(schemaResult, releaseSha),
    verifiedProvenance = checkedProvenance(provenance);
  artifacts = checkedArtifacts(artifacts, {
    target,
    releaseSha,
    accountId,
    schemaReceiptDigest,
  });
  const cf = (command, options) => {
    try {
      return (cloudflare ?? ((c, o) => cloudflareCommand(c, { ...o, env })))(
        command,
        options,
      );
    } catch {
      throw Error(
        "cf release readback failed; provider diagnostics suppressed.",
      );
    }
  };
  const subscriptions = cf(["accounts", "subscriptions", "get"]);
  if (
    !Array.isArray(subscriptions) ||
    subscriptions.some(
      (s) =>
        /workers/i.test(s.rate_plan?.id ?? "") && !/free/i.test(s.rate_plan.id),
    )
  )
    throw Error("The selected account must retain Workers Free.");
  if ((!previous && !bootstrap) || (previous && bootstrap))
    throw Error(
      "Supply the exact retained release or explicitly select a first-deployment bootstrap.",
    );
  let previousSnapshot = null;
  if (previous) {
    if (
      previous.target !== target ||
      previous.accountId !== accountId ||
      !DIGEST.test(previous.schemaReceiptDigest ?? "")
    )
      throw Error("The retained release target/account/schema is required.");
    for (const role of ROLES) {
      const identity = runtimeReleaseIdentity(previous.runtimeReleases?.[role]);
      if (
        identity.workerName !== `atlas-${role}-${target}` ||
        identity.namespaceClass !== roleClass(role)
      )
        throw Error("The retained runtime role/target differs.");
    }
    previousSnapshot = captureApiRuntimeSnapshot({
      accountId,
      runtimeReleases: previous.runtimeReleases,
      env,
      cloudflare: cf,
      now,
    });
    if (typeof probe !== "function")
      throw Error("Real paused-state probes are required before replacement.");
    for (const role of ROLES)
      await probeRole(
        probe,
        role,
        previous.runtimeReleases[role].releaseSha,
        previous.schemaReceiptDigest,
      );
  } else {
    const list = cf(["workers", "list"]);
    const workers = Array.isArray(list) ? list : list?.workers;
    if (
      !Array.isArray(workers) ||
      workers.some((w) =>
        ROLES.some((role) => (w.name ?? w.id) === `atlas-${role}-${target}`),
      )
    )
      throw Error("Bootstrap requires both selected Workers to be absent.");
  }
  if (bootstrap) {
    if (!bootstrapArtifact)
      throw Error(
        "An explicit paused API seed artifact is required for circular binding bootstrap.",
      );
    checkedArtifacts(
      { ...artifacts, api: bootstrapArtifact },
      {
        target,
        releaseSha,
        accountId,
        schemaReceiptDigest,
        allowSeedApi: true,
      },
    );
    const c = json(
      join(
        bootstrapArtifact.directory,
        ".cloudflare/output/v0/workers/default/worker.config.json",
      ),
    );
    if (c.env?.DISCOVERY_RUNTIME)
      throw Error(
        "The nonpromotable API seed must omit the unresolved discovery binding.",
      );
  }
  const readRuntime = (role, artifact) =>
    readRuntimeIdentity(role, artifact, {
      target,
      releaseSha,
      schemaReceiptDigest,
      cf,
    });
  const manifest = {
    schemaVersion: 1,
    kind: "cloudflare-api-release",
    target,
    accountId,
    releaseSha,
    schemaReceiptDigest,
    provenance: verifiedProvenance,
    productionEligible: false,
    eligibilityReason:
      "Consumer handoff and joint functional/performance/quota/rollback acceptance remain separate.",
    status: "planned",
    runtimeReleases: {},
    checks: [],
    rollbackPlan: null,
    retainedSnapshot: null,
  };
  if (!apply) return manifest;
  if (
    typeof deploy !== "function" ||
    typeof probe !== "function" ||
    typeof checkpoint !== "function"
  )
    throw Error(
      "Deployment, real probes and durable checkpoint callbacks are required.",
    );
  const save = (phase) =>
    checkpoint({
      schemaVersion: 1,
      phase,
      updatedAt: new Date(now()).toISOString(),
      previousSnapshot,
      manifest: structuredClone(manifest),
    });
  await save("prepared");
  const known = { ...(previousSnapshot?.runtimeReleases ?? {}) };
  try {
    if (bootstrap) {
      const inventory = cf(["workers", "list"]);
      const workers = Array.isArray(inventory) ? inventory : inventory?.workers;
      if (
        !Array.isArray(workers) ||
        workers.some((w) =>
          ROLES.some((role) => (w.name ?? w.id) === `atlas-${role}-${target}`),
        )
      )
        throw Error("Bootstrap Worker inventory changed before deployment.");
      await save("deploying-paused-api-seed");
      try {
        await deploy("api", bootstrapArtifact, {
          bootstrap: true,
          message: releaseMessage(
            target,
            "api",
            bootstrapArtifact.artifactDigest,
            schemaReceiptDigest,
          ),
          releaseSha,
        });
      } catch {
        throw Error(
          "Paused API seed deployment failed; private diagnostics suppressed.",
        );
      }
      manifest.bootstrapApi = {
        ...readRuntime("api", bootstrapArtifact),
        productionEligible: false,
      };
      known.api = runtimeReleaseIdentity(manifest.bootstrapApi);
      await save("deployed-paused-api-seed");
    }
    for (const role of ROLES) {
      if (Object.keys(known).length) assertRuntimeDeployments(known, cf);
      await save(`deploying-${role}`);
      try {
        await deploy(role, artifacts[role], {
          message: releaseMessage(
            target,
            role,
            artifacts[role].artifactDigest,
            schemaReceiptDigest,
          ),
          releaseSha,
        });
      } catch {
        throw Error(
          "Runtime deployment failed; private diagnostics suppressed.",
        );
      }
      manifest.runtimeReleases[role] = readRuntime(role, artifacts[role]);
      known[role] = manifest.runtimeReleases[role];
      if (
        role === "api" &&
        manifest.bootstrapApi?.workerVersionId ===
          manifest.runtimeReleases.api.workerVersionId &&
        manifest.bootstrapApi.artifactDigest !==
          manifest.runtimeReleases.api.artifactDigest
      )
        throw Error(
          "One immutable Worker version cannot name different seed/final artifacts.",
        );
      if (previousSnapshot) {
        const current = {
          ...previousSnapshot.runtimeReleases,
          ...manifest.runtimeReleases,
        };
        manifest.rollbackPlan = createApiRollbackPlan({
          snapshot: previousSnapshot,
          current,
        });
      }
      await save(`deployed-${role}`);
    }
    assertRuntimeDeployments(manifest.runtimeReleases, cf);
    for (const role of ROLES)
      manifest.checks.push(
        ...(await probeRole(probe, role, releaseSha, schemaReceiptDigest)),
      );
    checkedArtifacts(artifacts, {
      target,
      releaseSha,
      accountId,
      schemaReceiptDigest,
    });
    assertRuntimeDeployments(manifest.runtimeReleases, cf);
    manifest.retainedSnapshot = captureApiRuntimeSnapshot({
      accountId,
      runtimeReleases: manifest.runtimeReleases,
      env,
      cloudflare: cf,
      now,
    });
    manifest.status = "verified-paused";
    manifest.verifiedAt = new Date(now()).toISOString();
    await save("verified-paused");
    return manifest;
  } catch (error) {
    manifest.status = "verification-required";
    await save("verification-required");
    throw error;
  }
}

/** Resume real verification after a completed upload without redeploying or enabling work. */
export async function verifyPausedApiRelease({
  manifest,
  artifacts,
  env = process.env,
  cloudflare,
  probe,
  checkpoint,
  now = Date.now,
  verifyStage = async (_stage, action) => action(),
}) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.kind !== "cloudflare-api-release" ||
    !["staging", "production"].includes(manifest.target) ||
    manifest.productionEligible !== false ||
    !SHA.test(manifest.releaseSha ?? "") ||
    !DIGEST.test(manifest.schemaReceiptDigest ?? "") ||
    env.CLOUDFLARE_ACCOUNT_ID !== manifest.accountId ||
    !env.CLOUDFLARE_API_TOKEN?.trim() ||
    typeof probe !== "function" ||
    typeof checkpoint !== "function"
  )
    throw Error(
      "Exact retained release, session, real probes and durable checkpoint are required.",
    );
  const cf = (command, options) => {
    try {
      return (cloudflare ?? ((c, o) => cloudflareCommand(c, { ...o, env })))(
        command,
        options,
      );
    } catch {
      throw Error(
        "cf release verification failed; private diagnostics suppressed.",
      );
    }
  };
  const checked = structuredClone(manifest);
  if (!checked.runtimeReleases?.api) {
    // A routing readback can interrupt the deploy callback after the final API
    // upload. Recover its identity without replacing user data or enabling jobs.
    if (
      checked.status !== "verification-required" ||
      !checked.bootstrapApi ||
      !checked.runtimeReleases?.discovery ||
      checked.rollbackPlan ||
      !artifacts
    )
      throw Error(
        "Interrupted bootstrap recovery requires exact retained artifacts.",
      );
    checkedProvenance(checked.provenance);
    const retained = checkedArtifacts(artifacts, checked);
    const seed = runtimeReleaseIdentity(checked.bootstrapApi);
    if (
      seed.workerName !== `atlas-api-${checked.target}` ||
      seed.namespaceClass !== "ApiRuntime" ||
      seed.releaseSha !== checked.releaseSha ||
      checked.runtimeReleases.discovery.artifactDigest !==
        retained.discovery.artifactDigest
    )
      throw Error("The retained bootstrap artifact identities differ.");
    assertRuntimeDeployments(checked.runtimeReleases, cf);
    const uploaded = readRuntimeIdentity("api", retained.api, {
      ...checked,
      cf,
    });
    if (
      uploaded.namespaceId !== seed.namespaceId ||
      uploaded.workerVersionId === seed.workerVersionId ||
      uploaded.artifactDigest === seed.artifactDigest
    )
      throw Error(
        "The final API must preserve the seed namespace with a distinct immutable artifact/version.",
      );
    checked.runtimeReleases.api = uploaded;
  }
  for (const role of ROLES) {
    const identity = runtimeReleaseIdentity(checked.runtimeReleases?.[role]);
    if (
      identity.releaseSha !== manifest.releaseSha ||
      identity.workerName !== `atlas-${role}-${manifest.target}` ||
      identity.namespaceClass !== roleClass(role)
    )
      throw Error("The retained role/release identity differs.");
    await verifyStage(`${role}-version`, () => {
      const v = cf([
        "workers",
        "versions",
        "get",
        identity.workerVersionId,
        "--worker-id",
        identity.workerName,
      ]);
      if (
        v?.id !== identity.workerVersionId ||
        v.annotations?.["workers/tag"] !== identity.releaseSha ||
        v.annotations?.["workers/message"] !==
          releaseMessage(
            manifest.target,
            role,
            identity.artifactDigest,
            manifest.schemaReceiptDigest,
          )
      )
        throw Error("Exact retained version/artifact readback failed.");
    });
  }
  await verifyStage("runtime-deployments-before", () =>
    assertRuntimeDeployments(checked.runtimeReleases, cf),
  );
  if (manifest.rollbackPlan) {
    const expected = createApiRollbackPlan({
      snapshot: manifest.rollbackPlan.snapshot,
      current: manifest.runtimeReleases,
    });
    if (expected.planId !== manifest.rollbackPlan.planId)
      throw Error("The retained joint rollback plan differs.");
  }
  checked.checks = [];
  for (const role of ROLES)
    checked.checks.push(
      ...(await verifyStage(`${role}-probes`, () =>
        probeRole(
          probe,
          role,
          manifest.releaseSha,
          manifest.schemaReceiptDigest,
        ),
      )),
    );
  await verifyStage("runtime-deployments-after", () =>
    assertRuntimeDeployments(checked.runtimeReleases, cf),
  );
  checked.retainedSnapshot = await verifyStage("runtime-snapshot", () =>
    captureApiRuntimeSnapshot({
      accountId: checked.accountId,
      runtimeReleases: checked.runtimeReleases,
      env,
      cloudflare: cf,
      now,
    }),
  );
  checked.status = "verified-paused";
  checked.verifiedAt = new Date(now()).toISOString();
  await checkpoint({
    schemaVersion: 1,
    phase: "verified-paused",
    updatedAt: checked.verifiedAt,
    manifest: structuredClone(checked),
  });
  return checked;
}

/** Access must be verified by the caller before this private operations route is deployed. */
export async function prepareOperationsOutput({
  destination,
  accountId,
  target,
  hostname,
  publicHostname,
}) {
  if (
    !["staging", "production"].includes(target) ||
    !/^[a-f0-9]{32}$/.test(accountId ?? "") ||
    !/^atlas-api-ops-(staging|production)\.[a-z0-9.-]+$/.test(hostname ?? "") ||
    !hostname.startsWith(`atlas-api-ops-${target}.`) ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(publicHostname ?? "") ||
    publicHostname === hostname
  )
    throw Error("An isolated operations hostname/target/account is required.");
  const code = readFileSync(
    join(ROOT, "services/api-cloudflare/public-edge/index.mjs"),
    "utf8",
  );
  const out = join(destination, ".cloudflare/output/v0"),
    worker = join(out, "workers/default");
  mkdirSync(join(worker, "bundle"), { recursive: true });
  writeFileSync(join(worker, "bundle/index.js"), code);
  writeFileSync(
    join(out, "config.json"),
    JSON.stringify({
      accountId,
      buildContext: { mode: "production", isPreview: false },
    }),
  );
  writeFileSync(
    join(worker, "worker.config.json"),
    JSON.stringify({
      name: `atlas-api-ops-${target}`,
      compatibilityDate: "2026-10-10",
      workersDev: false,
      previewUrls: false,
      domains: [hostname],
      env: {
        ATLAS_API_PUBLIC_HOSTNAME: { type: "text", value: publicHostname },
        ATLAS_API_OPERATIONS_HOSTNAME: { type: "text", value: hostname },
        ATLAS_EDGE_ORIGIN_SECRET: { type: "secret" },
        ...Object.fromEntries(
          ROLES.map((role) => [
            role === "api" ? "API_RUNTIME" : "DISCOVERY_RUNTIME",
            {
              type: "durable-object",
              worker: `atlas-${role}-${target}`,
              exportName: roleClass(role),
            },
          ]),
        ),
      },
      manifest: {
        type: "complete",
        mainModule: "index.js",
        modules: { "index.js": { type: "esm" } },
      },
    }),
  );
  await readBuildOutput(destination);
  return { directory: destination, code, artifactDigest: digestDirectory(out) };
}

function privateJson(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw Error(
      "Private runtime/settings/Access files must be regular owner-only files.",
    );
  return json(file);
}
/** Run only the pinned cf CLI with the caller's in-memory bearer session. */
export function deployReleaseArtifact(
  artifact,
  {
    message,
    releaseSha,
    settings,
    secrets,
    env = process.env,
    runner = spawnSync,
  } = {},
) {
  if (!env.CLOUDFLARE_API_TOKEN?.trim())
    throw Error(
      "Use an explicit in-memory Cloudflare session before publishing.",
    );
  const temporary = mkdtempSync(join(tmpdir(), "atlas-api-secrets-"));
  try {
    if (
      secrets !== undefined &&
      (settings !== undefined ||
        !secrets ||
        typeof secrets !== "object" ||
        Array.isArray(secrets) ||
        Object.keys(secrets).length !== 1 ||
        typeof secrets.ATLAS_EDGE_ORIGIN_SECRET !== "string" ||
        !secrets.ATLAS_EDGE_ORIGIN_SECRET.trim())
    )
      throw Error(
        "The edge accepts only its existing visitor-proof credential.",
      );
    const file = join(temporary, "secrets.json");
    if (settings !== undefined || secrets !== undefined)
      writeFileSync(
        file,
        JSON.stringify(
          secrets ?? { ATLAS_API_SETTINGS: JSON.stringify(settings) },
        ),
        { mode: 0o600 },
      );
    const result = runner(
      "pnpm",
      [
        "exec",
        "cf",
        "deploy",
        "--prebuilt",
        "--no-provision",
        "--mode",
        "production",
        "--tag",
        releaseSha,
        "--message",
        message,
        ...(settings === undefined && secrets === undefined
          ? []
          : ["--secrets-file", file]),
      ],
      {
        cwd: artifact.directory,
        env,
        encoding: "utf8",
        timeout: 300000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (result.error || result.status !== 0)
      throw Error(
        "cf runtime deployment failed; private diagnostics were suppressed.",
      );
  } catch {
    throw Error(
      "cf runtime deployment failed; private diagnostics were suppressed.",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function releaseCli(
  args = process.argv.slice(2),
  { env = process.env } = {},
) {
  const option = (flag) => {
    const index = args.indexOf(flag),
      value = args[index + 1];
    if (index < 0 || !value || value.startsWith("--"))
      throw Error(`${flag} is required.`);
    return value;
  };
  const target = option("--target"),
    directory = resolve(option("--directory")),
    runtimeFile = resolve(option("--runtime-file"));
  const clean = execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (clean && !args.includes("--verify-only"))
    throw Error("Commit release source before packaging/deployment.");
  if (
    !args.includes("--verify-only") &&
    existsSync(join(directory, "release-journal.json"))
  )
    throw Error(
      "Retain the existing release directory; use --verify-only or a new directory.",
    );
  const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim(),
    accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (
    !["staging", "production"].includes(target) ||
    !/^[a-f0-9]{32}$/.test(accountId ?? "") ||
    !env.CLOUDFLARE_API_TOKEN?.trim()
  )
    throw Error(
      "Explicit target/account and an in-memory cf session are required.",
    );
  const runtime = loadWebRuntime(JSON.stringify(privateJson(runtimeFile)));
  const { apiSettingsFromService } =
    await import("./api-cloudflare-settings.mjs");
  const settings = apiSettingsFromService(
    privateJson(resolve(option("--api-settings-file"))),
    runtime,
  );
  const access = privateJson(resolve(option("--access-file")));
  if (!access.id || !access.client_id || !access.client_secret)
    throw Error("Existing scoped Access service credentials are required.");
  if (args.includes("--verify-only")) {
    const journal = json(join(directory, "release-journal.json")),
      hostname = option("--operations-hostname"),
      zoneId = option("--zone-id");
    if (journal.manifest?.target !== target)
      throw Error("Retained release target differs.");
    const cf = (command, options) =>
      cloudflareCommand(command, { ...options, env });
    const verifyStage = (stage, operation) =>
      runPausedVerificationStage(stage, operation, async (record) =>
        appendFileSync(
          join(directory, "verification-diagnostics.jsonl"),
          JSON.stringify({
            ...record,
            ...(/^\d+$/.test(env.GITHUB_RUN_ID ?? "")
              ? { runId: env.GITHUB_RUN_ID }
              : {}),
          }) + "\n",
        ),
      );
    const app = await verifyStage("operations-access", async () => {
      const apps = cf(["zero-trust", "access", "applications", "list"]);
      const found = apps.find((a) => a.domain === hostname);
      if (!found?.id)
        throw Error("Retained operations Access application is absent.");
      const policy = cf([
        "zero-trust",
        "access",
        "applications",
        "get",
        found.id,
      ]);
      assertAccessPolicy(policy, policy.policies, hostname, access.id);
      return found;
    });
    await verifyStage("operations-domain", async () =>
      assertCandidateDomain(cf(["workers", "get", `atlas-api-ops-${target}`]), {
        workerName: `atlas-api-ops-${target}`,
        hostname,
        zoneId,
      }),
    );
    const headers = {
      "CF-Access-Client-Id": access.client_id,
      "CF-Access-Client-Secret": access.client_secret,
    };
    await verifyStage("operations-denial", async () => {
      const denied = await fetch(`https://${hostname}/api/health`, {
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
      if (denied.status !== 403)
        throw Error("Operations Access denial readback failed.");
    });
    const manifest = await verifyStage("runtime-verification", () =>
      verifyPausedApiRelease({
        verifyStage,
        manifest: journal.manifest,
        artifacts: Object.fromEntries(
          ROLES.map((role) => {
            const retained = join(directory, role);
            return [
              role,
              {
                directory: retained,
                artifactDigest: digestDirectory(
                  join(retained, ".cloudflare/output/v0"),
                ),
              },
            ];
          }),
        ),
        env,
        cloudflare: cf,
        probe: async ({ role, path }) => {
          const r = await fetch(`https://${hostname}/${role}${path}`, {
            headers,
            redirect: "manual",
            signal: AbortSignal.timeout(30000),
          });
          let body = null;
          try {
            body = await r.json();
          } catch {}
          return { status: r.status, body };
        },
        checkpoint: async (next) =>
          writeFileSync(
            join(directory, "release-journal.json"),
            JSON.stringify(next, null, 2) + "\n",
          ),
      }),
    );
    manifest.operations = {
      workerName: `atlas-api-ops-${target}`,
      hostname,
      accessAppId: app.id,
      workerVersionId: activeVersion(
        cf([
          "workers",
          "deployments",
          "list",
          "--worker",
          `atlas-api-ops-${target}`,
        ]),
      ),
      artifactDigest: digestDirectory(
        join(directory, "operations/.cloudflare/output/v0"),
      ),
    };
    writeFileSync(
      join(directory, "api-release.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        status: manifest.status,
        target,
        releaseSha: manifest.releaseSha,
        productionEligible: false,
      }),
    );
    return manifest;
  }
  const hyperdriveId = option("--hyperdrive-id"),
    zoneId = option("--zone-id"),
    hostname = option("--operations-hostname");
  if (
    !/^[a-f0-9]{32}$/.test(hyperdriveId) ||
    !/^[a-f0-9]{32}$/.test(zoneId) ||
    !hostname.endsWith(
      "." +
        new URL(runtime.ATLAS_WEB_CANONICAL_URL ?? runtime.ATLAS_PUBLIC_URL)
          .hostname,
    )
  )
    throw Error(
      "Explicit Hyperdrive/zone and isolated operations hostname are required.",
    );
  const cf = (command, options) =>
    cloudflareCommand(command, { ...options, env });
  validateRuntimeDatabase(
    cf(["hyperdrive", "get", hyperdriveId]),
    runtime.DATABASE_URL,
  );
  const apps = cf(["zero-trust", "access", "applications", "list"]);
  let app = apps.find((a) => a.domain === hostname);
  if (!app?.id && args.includes("--apply")) {
    const subscriptions = cf(["accounts", "subscriptions", "get"]);
    if (
      !Array.isArray(subscriptions) ||
      subscriptions.some(
        (s) =>
          /workers/i.test(s.rate_plan?.id ?? "") &&
          !/free/i.test(s.rate_plan.id),
      )
    )
      throw Error("Workers Free required before operations routing.");
    app = cf(["zero-trust", "access", "applications", "create"], {
      body: {
        name: `atlas-api-ops-${target}`,
        type: "self_hosted",
        domain: hostname,
        session_duration: "24h",
        policies: [
          {
            name: "Atlas paused release verification",
            decision: "non_identity",
            include: [{ service_token: { token_id: access.id } }],
          },
        ],
      },
    });
  }
  if (!app?.id)
    throw Error(
      "The operations Access application is absent; --apply provisions its exclusive existing service-token policy.",
    );
  const accessReadback = cf([
    "zero-trust",
    "access",
    "applications",
    "get",
    app.id,
  ]);
  assertAccessPolicy(
    accessReadback,
    accessReadback.policies,
    hostname,
    access.id,
  );
  const python = join(ROOT, "api/.venv/bin/python"),
    vendor = resolve(option("--vendor"));
  const provenance = JSON.parse(
    execFileSync(
      python,
      [
        join(ROOT, "scripts/deploy/api-cloudflare-provenance.py"),
        "--vendor",
        vendor,
        "--native-provenance",
        resolve(option("--native-provenance")),
        "--packages-provenance",
        resolve(option("--packages-provenance")),
      ],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  mkdirSync(directory, { recursive: true });
  const doctorFile = join(directory, "schema-doctor.json");
  execFileSync(
    python,
    [
      join(ROOT, "scripts/deploy/api_schema_release.py"),
      "--config-file",
      runtimeFile,
      "--release-sha",
      releaseSha,
      "--output",
      doctorFile,
    ],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const schemaResult = json(doctorFile),
    savedSchema = json(resolve(option("--schema-receipt")));
  if (
    savedSchema.receiptDigest !== schemaResult.receiptDigest ||
    canonicalDigest(savedSchema.receipt) !== schemaResult.receiptDigest
  )
    throw Error(
      "The supplied schema receipt differs from the live read-only doctor.",
    );
  const schemaReceiptDigest = checkedSchema(schemaResult, releaseSha),
    artifacts = {};
  for (const role of ROLES) {
    const destination = join(directory, role);
    await preparePythonOutput({
      source: join(ROOT, "services/api-cloudflare/compatibility"),
      additionalSources: [join(ROOT, "services/api-cloudflare/production")],
      vendor,
      destination,
      workerName: `atlas-${role}-${target}`,
      accountId,
      durableExport: roleClass(role),
      entrypoint:
        role === "api" ? "production_entry.py" : "production_discovery.py",
      packagesAsset: true,
      releaseTarget: target,
      workerRole: role,
      workerEnv: {
        ATLAS_API_SETTINGS: { type: "secret" },
        HYPERDRIVE: { type: "hyperdrive", id: hyperdriveId },
        ATLAS_RELEASE_SHA: { type: "text", value: releaseSha },
        ATLAS_ACTIVE_RELEASE_SHA: { type: "text", value: "" },
        ATLAS_SCHEMA_RECEIPT_DIGEST: {
          type: "text",
          value: schemaReceiptDigest,
        },
        API_RUNTIME: {
          type: "durable-object",
          worker: `atlas-api-${target}`,
          exportName: "ApiRuntime",
        },
        DISCOVERY_RUNTIME: {
          type: "durable-object",
          worker: `atlas-discovery-${target}`,
          exportName: "DiscoveryRuntime",
        },
      },
    });
    artifacts[role] = {
      directory: destination,
      artifactDigest: digestDirectory(
        join(destination, ".cloudflare/output/v0"),
      ),
    };
  }
  const bootstrapArtifact = args.includes("--bootstrap")
    ? { directory: join(directory, "bootstrap-api") }
    : undefined;
  if (bootstrapArtifact) {
    cpSync(artifacts.api.directory, bootstrapArtifact.directory, {
      recursive: true,
    });
    const file = join(
        bootstrapArtifact.directory,
        ".cloudflare/output/v0/workers/default/worker.config.json",
      ),
      c = json(file);
    delete c.env.DISCOVERY_RUNTIME;
    writeFileSync(file, JSON.stringify(c));
    bootstrapArtifact.artifactDigest = digestDirectory(
      join(bootstrapArtifact.directory, ".cloudflare/output/v0"),
    );
  }
  const ops = await prepareOperationsOutput({
    destination: join(directory, "operations"),
    accountId,
    target,
    hostname,
    publicHostname: new URL(runtime.ATLAS_SERVER_API_PROXY_TARGET).hostname,
  });
  const headers = {
    "CF-Access-Client-Id": access.client_id,
    "CF-Access-Client-Secret": access.client_secret,
  };
  const probe = async ({ role, path }) => {
    const r = await fetch(`https://${hostname}/${role}${path}`, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    let body = null;
    try {
      body = await r.json();
    } catch {}
    return { status: r.status, body };
  };
  let operationsDeployed = false;
  const previous = args.includes("--previous-release")
    ? json(resolve(option("--previous-release")))
    : undefined;
  const manifest = await publishApiRelease({
    target,
    releaseSha,
    accountId,
    env,
    schemaResult,
    provenance,
    artifacts,
    bootstrapArtifact,
    previous,
    bootstrap: args.includes("--bootstrap"),
    cloudflare: cf,
    probe,
    apply: args.includes("--apply"),
    checkpoint: async (journal) => {
      writeFileSync(
        join(directory, "release-journal.json"),
        JSON.stringify(journal, null, 2) + "\n",
      );
      if (journal.manifest.rollbackPlan)
        writeFileSync(
          join(directory, "api-rollback-plan.json"),
          JSON.stringify(journal.manifest.rollbackPlan, null, 2) + "\n",
        );
    },
    deploy: async (role, artifact, identity) => {
      // Replace only paused runtimes. Bindings to the other role are stable names,
      // so this cannot silently redirect a public web route or enable consumers.
      deployReleaseArtifact(artifact, { ...identity, settings, env });
      if (role === "api" && !identity.bootstrap && !operationsDeployed) {
        deployReleaseArtifact(ops, {
          releaseSha,
          message: `Atlas ${target} protected runtime verification; artifact=${ops.artifactDigest}`,
          secrets: {
            ATLAS_EDGE_ORIGIN_SECRET: runtime.ATLAS_EDGE_ORIGIN_SECRET,
          },
          env,
        });
        operationsDeployed = true;
        assertCandidateDomain(
          cf(["workers", "get", `atlas-api-ops-${target}`]),
          { workerName: `atlas-api-ops-${target}`, hostname, zoneId },
        );
        const denied = await fetch(`https://${hostname}/api/health`, {
          redirect: "manual",
          signal: AbortSignal.timeout(30000),
        });
        if (denied.status !== 403)
          throw Error(
            "The operations endpoint must reject requests without Access credentials.",
          );
      }
    },
  });
  manifest.operations = {
    workerName: `atlas-api-ops-${target}`,
    hostname,
    artifactDigest: ops.artifactDigest,
    accessAppId: app.id,
    workerVersionId: activeVersion(
      cf([
        "workers",
        "deployments",
        "list",
        "--worker",
        `atlas-api-ops-${target}`,
      ]),
    ),
  };
  writeFileSync(
    join(directory, "api-release.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: manifest.status,
      target,
      releaseSha,
      productionEligible: false,
      manifest: join(directory, "api-release.json"),
    }),
  );
  return manifest;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  releaseCli().catch(() => {
    console.error(
      "API release failed; credential-bearing provider, database and configuration diagnostics were suppressed. Inspect the retained release journal, then run read-only doctor/readback or explicit rollback.",
    );
    process.exitCode = 1;
  });
}
