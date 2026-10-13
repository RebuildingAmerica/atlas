#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertPromotionReady,
  copyWebArtifact,
  createWebManifest,
  digestDirectory,
  verifyWebManifest,
  WEB_PUBLIC_ENV_KEYS,
} from "./web-release.mjs";
import {
  loadWebRuntime,
  runtimeInput,
  publishWebCandidate,
  assertCandidateDomain,
} from "./web-candidate.mjs";
import { preserveRuntimeIdentity } from "./web-runtime-identity.mjs";
import { probeWebRelease, summarizeWebObservations } from "./web-observe.mjs";
import { archiveWebRelease } from "./web-archive.mjs";
import { applyRecoveryDomains } from "./web-rollback.mjs";
import { cloudflareCommand } from "./cloudflare-cli.mjs";
import { restoreApiRuntimeSnapshot } from "./api-runtime-rollback.mjs";
import {
  assertRuntimeDeployments,
  runtimeReleaseIdentity,
  sameRuntimeRelease,
  validateReleasePolicy,
} from "./web-assess.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
function save(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Promotion preserves the exact searchable client/server and existing account credentials. */
export function planWebPromotion({
  source,
  runtime,
  evidence,
  records,
  now = Date.now(),
}) {
  runtime = loadWebRuntime(JSON.stringify(runtime));
  if (
    runtime.ATLAS_WEB_CANONICAL_URL &&
    runtime.ATLAS_WEB_CANONICAL_URL !== runtime.ATLAS_PUBLIC_URL
  )
    throw new Error(
      "Promotion requires the original canonical production runtime.",
    );
  runtime = {
    ...runtime,
    ATLAS_WEB_CANONICAL_URL: runtime.ATLAS_PUBLIC_URL,
    ATLAS_PASSKEY_RP_ID:
      runtime.ATLAS_PASSKEY_RP_ID || new URL(runtime.ATLAS_PUBLIC_URL).hostname,
  };
  const candidate = read(join(source, "deployment.json"));
  const original = read(join(source, "manifest.json"));
  const observed = {
    releaseSha: candidate.releaseSha,
    artifactDigest: digestDirectory(join(source, "artifact")),
    assetsDigest: digestDirectory(join(source, "assets")),
  };
  verifyWebManifest(candidate, observed);
  for (const key of [
    "target",
    "architecture",
    "workerName",
    "releaseSha",
    "artifactDigest",
    "assetsDigest",
    "authSchemaVersion",
    "sourceDirty",
    "publicEnv",
    "buildPublicEnv",
    "execution",
    "runtimeDependencies",
    "releasePolicy",
  ])
    if (JSON.stringify(original[key]) !== JSON.stringify(candidate[key]))
      throw new Error("Candidate manifest and published artifacts differ.");
  if (
    candidate.target !== "staging" ||
    candidate.publicEnv.ATLAS_WEB_CANONICAL_URL !== runtime.ATLAS_PUBLIC_URL ||
    candidate.candidateUrl !==
      `https://${candidate.workerName}.${new URL(runtime.ATLAS_PUBLIC_URL).hostname}` ||
    candidate.accountId !== evidence.cloudflare?.accountId ||
    !/^[a-f0-9]{32}$/.test(candidate.accountId ?? "") ||
    !/^[a-f0-9]{32}$/.test(candidate.zoneId ?? "")
  )
    throw new Error(
      "Promotion requires the protected staging release in the measured account.",
    );
  if (!candidate.runtimeIdentity)
    throw new Error("The published runtime credential commitment is required.");
  preserveRuntimeIdentity(
    runtime,
    candidate.releaseSha,
    candidate.runtimeIdentity,
  );
  if (!records.length || records.some((row) => row.protectedCandidate !== true))
    throw new Error("Protected staging observations are required.");
  const releasePolicy = validateReleasePolicy(
    evidence.releasePolicy,
    candidate.releaseSha,
    now,
  );
  if (
    JSON.stringify(releasePolicy) !==
    JSON.stringify(candidate.releasePolicy ?? null)
  )
    throw new Error("The candidate must retain the recorded operator policy.");
  const staging = summarizeWebObservations(records, {
    ...candidate,
    origin: candidate.candidateUrl,
    now,
    minimumHours: releasePolicy ? 0 : 24,
    releasePolicy,
  });
  assertPromotionReady({ ...evidence, staging }, candidate, now);
  const manifest = createWebManifest({
    ...candidate,
    target: "production",
    publicEnv: runtime,
  });
  if (
    WEB_PUBLIC_ENV_KEYS.some(
      (key) => manifest.buildPublicEnv[key] !== candidate.buildPublicEnv[key],
    )
  )
    throw new Error(
      "Production requires exactly the candidate's compiled public configuration.",
    );
  return { manifest, candidate, runtime, staging, releasePolicy };
}

function prepareProductionArtifacts(source, directory, manifest) {
  if (existsSync(directory)) {
    if (
      realpathSync(directory) !== directory ||
      JSON.stringify(read(join(directory, "manifest.json"))) !==
        JSON.stringify(manifest)
    )
      throw new Error(
        "Existing production directory belongs to a different promotion.",
      );
  } else {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    copyWebArtifact(join(source, "artifact"), join(directory, "artifact"));
    copyWebArtifact(join(source, "assets"), join(directory, "assets"));
    save(join(directory, "manifest.json"), manifest);
  }
  verifyWebManifest(manifest, {
    releaseSha: manifest.releaseSha,
    artifactDigest: digestDirectory(join(directory, "artifact")),
    assetsDigest: digestDirectory(join(directory, "assets")),
  });
}

function jointRuntimes(deployment) {
  return {
    web: runtimeReleaseIdentity({
      ...deployment,
      namespaceId: deployment.durableNamespaceId,
      namespaceClass: "AtlasAppRuntime",
      storage: "sqlite",
    }),
    api: runtimeReleaseIdentity(deployment.runtimeDependencies?.api),
    discovery: runtimeReleaseIdentity(
      deployment.runtimeDependencies?.discovery,
    ),
  };
}

function retainedCloudflareRelease(source, runtime, expected, newWorkerName) {
  const retained = read(join(source, "deployment.json"));
  const manifest = read(join(source, "manifest.json"));
  verifyWebManifest(retained, {
    releaseSha: manifest.releaseSha,
    artifactDigest: digestDirectory(join(source, "artifact")),
    assetsDigest: digestDirectory(join(source, "assets")),
  });
  for (const key of [
    "target",
    "execution",
    "architecture",
    "releaseSha",
    "workerName",
    "artifactDigest",
    "assetsDigest",
    "publicEnv",
    "buildPublicEnv",
    "runtimeDependencies",
    "releasePolicy",
  ])
    if (JSON.stringify(manifest[key]) !== JSON.stringify(retained[key]))
      throw new Error(
        "The retained Cloudflare manifest and deployment differ.",
      );
  if (
    retained.target !== "production" ||
    retained.execution !== "cloudflare-durable" ||
    retained.promotionState !== "active" ||
    retained.accountId !== expected.accountId ||
    retained.zoneId !== expected.zoneId ||
    retained.workerName === newWorkerName ||
    retained.publicEnv.ATLAS_PUBLIC_URL !== runtime.ATLAS_PUBLIC_URL ||
    retained.candidateUrl !==
      `https://${retained.workerName}.${expected.hostname}`
  )
    throw new Error(
      "Cloudflare recovery requires a distinct retained active production release in the same account and zone.",
    );
  if (!retained.runtimeIdentity)
    throw new Error(
      "The retained Cloudflare credential commitment is required.",
    );
  preserveRuntimeIdentity(
    runtime,
    retained.releaseSha,
    retained.runtimeIdentity,
  );
  jointRuntimes(retained);
  return retained;
}

function recoveryDomains(deployment, expected, cloudflare) {
  const worker = cloudflare(["workers", "get", deployment.workerName]);
  const domains = worker.references?.domains;
  const candidate = new URL(deployment.candidateUrl).hostname;
  if (
    worker.name !== deployment.workerName ||
    !Array.isArray(domains) ||
    !domains.some((row) => row.hostname === candidate) ||
    domains.some(
      (row) =>
        row.zone_id !== expected.zoneId ||
        ![candidate, expected.hostname].includes(row.hostname),
    )
  )
    throw new Error(
      "Cloudflare recovery domain ownership differs from the retained release.",
    );
  return domains.map((row) => row.hostname);
}

async function checkRuntimeRecovery(previous, current, runtimeRollback, apply) {
  const changed = ["api", "discovery"].some(
    (key) => !sameRuntimeRelease(previous[key], current[key]),
  );
  if (!changed) return;
  if (typeof runtimeRollback !== "function")
    throw new Error(
      "Changed API/discovery identities require explicit joint runtime recovery before Cloudflare routing can be promoted.",
    );
  const result = await runtimeRollback({ apply, previous, current });
  if (
    (!apply && result?.status !== "ready") ||
    (apply && result?.readbackPassed !== true)
  )
    throw new Error(
      "Joint API/discovery recovery did not pass its provider checks.",
    );
}

function apiRecovery({
  apiRollbackPlan,
  runtimeRollback,
  directory,
  expected,
  retained,
  runtime,
  probe,
  cloudflare,
}) {
  if (!apiRollbackPlan) return runtimeRollback;
  if (!/^[a-f0-9]{64}$/.test(apiRollbackPlan.planId ?? ""))
    throw new Error(
      "An exact API/discovery rollback plan identity is required.",
    );
  if (runtimeRollback)
    throw new Error(
      "Choose one explicit API/discovery recovery implementation.",
    );
  return async ({ apply, previous, current }) => {
    if (
      apiRollbackPlan.snapshot?.accountId !== expected.accountId ||
      !["api", "discovery"].every(
        (key) =>
          sameRuntimeRelease(
            apiRollbackPlan.snapshot?.runtimeReleases?.[key],
            previous[key],
          ) && sameRuntimeRelease(apiRollbackPlan.current?.[key], current[key]),
      )
    )
      throw new Error(
        "API/discovery recovery plan differs from the exact web release dependencies.",
      );
    const journalFile = join(
      directory,
      `runtime-rollback-${apiRollbackPlan.planId}.json`,
    );
    return restoreApiRuntimeSnapshot({
      plan: apiRollbackPlan,
      apply,
      cloudflare,
      journal: existsSync(journalFile) ? read(journalFile) : undefined,
      checkpoint: (entry) => save(journalFile, entry),
      probe: async () => {
        const report = await probe({
          ...retained,
          origin: retained.candidateUrl,
          canonicalOrigin: runtime.ATLAS_PUBLIC_URL,
          clientId: process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_ID,
          clientSecret: process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET,
                  cloudflare,
        });
        const evidenceReference = join(
          directory,
          "rollback-api-observations.jsonl",
        );
        appendFileSync(evidenceReference, JSON.stringify(report) + "\n", {
          mode: 0o600,
          flush: true,
        });
        return { status: report.status, evidenceReference };
      },
    });
  };
}

/** Resume trigger-only Cloudflare recovery; version/storage and real journey checks remain mandatory. */
export async function restoreCloudflareWebRouting({
  snapshot,
  deployment,
  directory,
  runtime,
  expected,
  journal,
  checkpoint,
  cloudflare = cloudflareCommand,
  applyDomains = applyRecoveryDomains,
  probe = probeWebRelease,
  runtimeRollback,
  apiRollbackPlan,
  apply = false,
}) {
  const retained = retainedCloudflareRelease(
    snapshot.directory,
    runtime,
    expected,
    deployment.workerName,
  );
  runtimeRollback = apiRecovery({
    apiRollbackPlan,
    runtimeRollback,
    directory,
    expected,
    retained,
    runtime,
    probe,
      cloudflare,
  });
  if (
    snapshot.kind !== "cloudflare-web-routing" ||
    snapshot.accountId !== expected.accountId ||
    snapshot.zoneId !== expected.zoneId ||
    snapshot.hostname !== expected.hostname ||
    JSON.stringify(snapshot.deployment) !== JSON.stringify(retained)
  )
    throw new Error(
      "The Cloudflare recovery snapshot differs from its retained deployment.",
    );
  const operationId = createHash("sha256")
    .update(
      JSON.stringify({
        snapshot,
        current: jointRuntimes(deployment),
        assetsDigest: deployment.assetsDigest,
      }),
    )
    .digest("hex");
  if (
    !journal ||
    journal.operationId !== operationId ||
    ![
      "prepared",
      "previous-detached",
      "candidate-attached",
      "candidate-detached",
      "runtimes-restored",
      "restored",
      "verified",
    ].includes(journal.phase)
  )
    throw new Error(
      "The Cloudflare routing journal belongs to another operation.",
    );
  const zone = cloudflare(["zones", "get", "--zone", expected.zoneId]);
  if (
    zone.id !== expected.zoneId ||
    zone.account?.id !== expected.accountId ||
    !expected.hostname.endsWith("." + zone.name)
  )
    throw new Error("Cloudflare recovery zone and account readback failed.");
  const previous = jointRuntimes(retained),
    current = jointRuntimes(deployment);
  assertRuntimeDeployments(
    { previousWeb: previous.web, currentWeb: current.web },
    cloudflare,
  );
  const oldDomains = recoveryDomains(retained, expected, cloudflare);
  const newDomains = recoveryDomains(deployment, expected, cloudflare);
  if (
    oldDomains.includes(expected.hostname) &&
    newDomains.includes(expected.hostname)
  )
    throw new Error("Two Workers unexpectedly own the production hostname.");
  await checkRuntimeRecovery(previous, current, runtimeRollback, false);
  if (
    ["api", "discovery"].every((key) =>
      sameRuntimeRelease(previous[key], current[key]),
    )
  )
    assertRuntimeDeployments(
      { api: previous.api, discovery: previous.discovery },
      cloudflare,
    );
  if (!apply) return { status: "ready", operationId };
  if (typeof checkpoint !== "function")
    throw new Error("A durable Cloudflare recovery journal is required.");
  if (newDomains.includes(expected.hostname)) {
    await applyDomains({
      directory,
      deployment,
      domains: [new URL(deployment.candidateUrl).hostname],
    });
    if (
      recoveryDomains(deployment, expected, cloudflare).includes(
        expected.hostname,
      )
    )
      throw new Error("Failed candidate domain removal was not confirmed.");
  }
  checkpoint({ operationId, phase: "candidate-detached" });
  await checkRuntimeRecovery(previous, current, runtimeRollback, true);
  assertRuntimeDeployments(
    { api: previous.api, discovery: previous.discovery },
    cloudflare,
  );
  checkpoint({ operationId, phase: "runtimes-restored" });
  if (!oldDomains.includes(expected.hostname))
    await applyDomains({
      directory: snapshot.directory,
      deployment: retained,
      domains: [new URL(retained.candidateUrl).hostname, expected.hostname],
    });
  if (
    !recoveryDomains(retained, expected, cloudflare).includes(
      expected.hostname,
    ) ||
    recoveryDomains(deployment, expected, cloudflare).includes(
      expected.hostname,
    )
  )
    throw new Error(
      "Retained Cloudflare routing restoration was not confirmed.",
    );
  checkpoint({ operationId, phase: "restored" });
  assertRuntimeDeployments(previous, cloudflare);
  const report = await probe({
    ...retained,
    origin: runtime.ATLAS_PUBLIC_URL,
    canonicalOrigin: runtime.ATLAS_PUBLIC_URL,
      cloudflare,
  });
  appendFileSync(
    join(directory, "rollback-observations.jsonl"),
    JSON.stringify(report) + "\n",
    { mode: 0o600, flush: true },
  );
  if (report.status !== "pass")
    throw new Error("Restored Cloudflare production journeys failed.");
  assertRuntimeDeployments(previous, cloudflare);
  if (
    !recoveryDomains(retained, expected, cloudflare).includes(expected.hostname)
  )
    throw new Error("Restored routing changed during hosted verification.");
  checkpoint({ operationId, phase: "verified" });
  return {
    status: "routing-restored",
    operationId,
    readbackPassed: true,
    runtimeReleases: previous,
  };
}

async function promoteWithCloudflareRecovery({
  plan,
  source,
  directory,
  runtime,
  evidence,
  records,
  expected,
  rollbackSource,
  cloudflare,
  publish,
  applyDomains,
  probe,
  archive,
  runtimeRollback,
  apiRollbackPlan,
}) {
  if (plan.manifest.execution !== "cloudflare-durable")
    throw new Error(
      "Cloudflare-only recovery requires the selected Durable Object release policy.",
    );
  const retained = retainedCloudflareRelease(
    rollbackSource,
    plan.runtime,
    expected,
    plan.manifest.workerName,
  );
  runtimeRollback = apiRecovery({
    apiRollbackPlan,
    runtimeRollback,
    directory,
    expected,
    retained,
    runtime: plan.runtime,
    probe,
      cloudflare,
  });
  const previous = jointRuntimes(retained);
  assertRuntimeDeployments(
    { web: previous.web, ...plan.manifest.runtimeDependencies },
    cloudflare,
  );
  if (
    !recoveryDomains(retained, expected, cloudflare).includes(expected.hostname)
  )
    throw new Error(
      "The retained Cloudflare Worker does not currently own production routing.",
    );
  await checkRuntimeRecovery(
    previous,
    plan.manifest.runtimeDependencies,
    runtimeRollback,
    false,
  );
  const snapshot = {
    kind: "cloudflare-web-routing",
    directory: rollbackSource,
    accountId: expected.accountId,
    zoneId: expected.zoneId,
    hostname: expected.hostname,
    deployment: retained,
  };
  prepareProductionArtifacts(source, directory, plan.manifest);
  const snapshotFile = join(
    directory,
    `rollback-cloudflare-${randomUUID()}.json`,
  );
  save(snapshotFile, snapshot);
  const deployment = await publish(
    directory,
    "production",
    plan.manifest.architecture,
    { promotion: plan.candidate, runtime: plan.runtime },
  );
  const production = {
    ...deployment,
    productionUrl: plan.runtime.ATLAS_PUBLIC_URL,
    promotionState: "prepared",
    rollbackProvider: "cloudflare",
    rollbackSnapshotFile: snapshotFile,
    stagedWorkerVersionId: plan.candidate.workerVersionId,
  };
  production.observationJournal = join(
    directory,
    `production-observations-${production.workerVersionId}.jsonl`,
  );
  save(join(directory, "deployment.json"), production);
  archive({ directory, runtime: plan.runtime });
  planWebPromotion({ source, runtime, evidence, records });
  const operationId = createHash("sha256")
    .update(
      JSON.stringify({
        snapshot,
        current: jointRuntimes(production),
        assetsDigest: production.assetsDigest,
      }),
    )
    .digest("hex");
  let journal = { operationId, phase: "prepared" };
  const checkpoint = (entry) => {
    save(join(directory, "routing-rollback.json"), entry);
    journal = entry;
  };
  checkpoint(journal);
  const recovery = {
    snapshot,
    deployment: production,
    directory,
    runtime: plan.runtime,
    expected,
    journal,
    checkpoint,
    cloudflare,
    applyDomains,
    probe,
      runtimeRollback,
  };
  await restoreCloudflareWebRouting(recovery);
  try {
    await applyDomains({
      directory: rollbackSource,
      deployment: retained,
      domains: [new URL(retained.candidateUrl).hostname],
    });
    if (
      recoveryDomains(retained, expected, cloudflare).includes(
        expected.hostname,
      )
    )
      throw new Error("Previous production domain removal was not confirmed.");
    checkpoint({ operationId, phase: "previous-detached" });
    await applyDomains({
      directory,
      deployment: production,
      domains: [new URL(production.candidateUrl).hostname, expected.hostname],
    });
    if (
      !recoveryDomains(production, expected, cloudflare).includes(
        expected.hostname,
      )
    )
      throw new Error(
        "Cloudflare production domain attachment was not confirmed.",
      );
    checkpoint({ operationId, phase: "candidate-attached" });
    assertRuntimeDeployments(jointRuntimes(production), cloudflare);
    const report = await probe({
      ...production,
      origin: production.productionUrl,
      canonicalOrigin: production.productionUrl,
          cloudflare,
    });
    appendFileSync(
      production.observationJournal,
      JSON.stringify(report) + "\n",
      { mode: 0o600, flush: true },
    );
    if (report.status !== "pass")
      throw new Error("Immediate production probes failed.");
    assertRuntimeDeployments(jointRuntimes(production), cloudflare);
    if (
      !recoveryDomains(production, expected, cloudflare).includes(
        expected.hostname,
      )
    )
      throw new Error("Production routing changed during hosted verification.");
    production.promotionState = "active";
    save(join(directory, "deployment.json"), production);
    archive({ directory, runtime: plan.runtime });
    return {
      status: "promoted",
      productionUrl: production.productionUrl,
      workerVersionId: production.workerVersionId,
      rollbackProvider: "cloudflare",
      rollbackSnapshotFile: snapshotFile,
      observationJournal: production.observationJournal,
      observationRequiredHours: 0,
      releasePolicy: plan.releasePolicy,
      observationWindowWaived: true,
    };
  } catch {
    try {
      await restoreCloudflareWebRouting({ ...recovery, journal, apply: true });
    } catch {
      production.promotionState = "recovery-required";
      save(join(directory, "deployment.json"), production);
      throw new Error(
        "Production cutover failed and automatic Cloudflare recovery failed. Use the retained Cloudflare snapshot and exact routing/runtime journals for recovery.",
      );
    }
    production.promotionState = "rolled-back";
    save(join(directory, "deployment.json"), production);
    throw new Error(
      "Production cutover failed; retained Cloudflare routing was restored and verified.",
    );
  }
}

export async function promoteWebRelease({
  source,
  directory,
  runtime,
  evidence,
  records,
  expected,
  cloudflare = cloudflareCommand,
  publish = publishWebCandidate,
  applyDomains = applyRecoveryDomains,
  probe = probeWebRelease,
  archive = archiveWebRelease,
  rollbackSource,
  runtimeRollback,
  apiRollbackPlan,
}) {
  if (!rollbackSource)
    throw new Error(
      "Production promotion requires explicit Cloudflare routing recovery.",
    );
  const plan = planWebPromotion({ source, runtime, evidence, records });
  if (
    expected.target !== "production" ||
    expected.hostname !== new URL(plan.runtime.ATLAS_PUBLIC_URL).hostname ||
    expected.accountId !== plan.candidate.accountId ||
    expected.zoneId !== plan.candidate.zoneId
  )
    throw new Error(
      "Production and rollback provider identities must match the evaluated release.",
    );
  return promoteWithCloudflareRecovery({
    plan,
    source,
    directory,
    runtime,
    evidence,
    records,
    expected,
    rollbackSource,
    cloudflare,
    publish,
    applyDomains,
    probe,
      archive,
    runtimeRollback,
    apiRollbackPlan,
  });
}

/** Resume the retained operation without requiring stale candidate observations to be recreated. */
export async function recoverPromotedCloudflareRelease({
  directory,
  runtime,
  expected,
  apiRollbackPlan,
  apply = false,
  cloudflare = cloudflareCommand,
  applyDomains = applyRecoveryDomains,
  probe = probeWebRelease,
  archive = archiveWebRelease,
}) {
  const deployment = read(join(directory, "deployment.json"));
  if (
    deployment.rollbackProvider !== "cloudflare" ||
    expected.target !== "production" ||
    deployment.accountId !== expected.accountId ||
    deployment.zoneId !== expected.zoneId ||
    new URL(deployment.productionUrl).hostname !== expected.hostname ||
    resolve(deployment.rollbackSnapshotFile, "..") !== resolve(directory)
  )
    throw new Error(
      "Explicit Cloudflare recovery must match the retained production operation.",
    );
  verifyWebManifest(deployment, {
    releaseSha: deployment.releaseSha,
    artifactDigest: digestDirectory(join(directory, "artifact")),
    assetsDigest: digestDirectory(join(directory, "assets")),
  });
  const manifest = read(join(directory, "manifest.json"));
  for (const key of [
    "target",
    "architecture",
    "workerName",
    "releaseSha",
    "artifactDigest",
    "assetsDigest",
    "publicEnv",
    "buildPublicEnv",
    "execution",
    "runtimeDependencies",
    "releasePolicy",
  ])
    if (JSON.stringify(manifest[key]) !== JSON.stringify(deployment[key]))
      throw new Error(
        "Cloudflare recovery requires the unchanged production manifest and deployment.",
      );
  const result = await restoreCloudflareWebRouting({
    snapshot: read(deployment.rollbackSnapshotFile),
    deployment,
    directory,
    runtime: { ...runtime, ATLAS_WEB_CANONICAL_URL: runtime.ATLAS_PUBLIC_URL },
    expected,
    journal: read(join(directory, "routing-rollback.json")),
    checkpoint: (entry) =>
      save(join(directory, "routing-rollback.json"), entry),
    cloudflare,
    applyDomains,
    probe,
      apiRollbackPlan,
    apply,
  });
  if (apply) {
    deployment.promotionState = "rolled-back";
    save(join(directory, "deployment.json"), deployment);
    archive({ directory, runtime });
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2),
    value = (key) =>
      args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  if (args.includes("--api-rollback-plan") && !value("--api-rollback-plan"))
    throw new Error(
      "An explicit API/discovery rollback plan file is required.",
    );
  if (args.includes("--restore-cloudflare-routing")) {
    if (
      value("--target") !== "production" ||
      !value("--directory") ||
      !value("--hostname")
    )
      throw new Error(
        "Cloudflare recovery requires the explicit production target, directory and hostname.",
      );
    const directory = resolve(value("--directory"));
    if (
      !directory.startsWith(join(ROOT, ".atlas") + sep) ||
      realpathSync(directory) !== directory
    )
      throw new Error(
        "An ignored .atlas production directory without symbolic links is required.",
      );
    console.log(
      JSON.stringify(
        await recoverPromotedCloudflareRelease({
          directory,
          runtime: loadWebRuntime(runtimeInput()),
          expected: {
            target: "production",
            hostname: value("--hostname"),
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
            zoneId: process.env.CLOUDFLARE_ZONE_ID,
          },
          apiRollbackPlan: value("--api-rollback-plan")
            ? read(resolve(value("--api-rollback-plan")))
            : undefined,
          apply: args.includes("--apply"),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (
    value("--target") !== "production" ||
    !value("--source") ||
    !value("--journal") ||
    !value("--evidence") ||
    (args.includes("--apply") && !value("--directory"))
  )
    throw new Error(
      "Explicit production target, staging source, observation journal, evidence and apply destination are required.",
    );
  const source = resolve(value("--source"));
  const directory = value("--directory")
    ? resolve(value("--directory"))
    : undefined;
  const rollbackSource = value("--rollback-cloudflare-source")
    ? resolve(value("--rollback-cloudflare-source"))
    : undefined;
  if (args.includes("--rollback-cloudflare-source") && !rollbackSource)
    throw new Error(
      "An explicit retained Cloudflare production directory is required.",
    );
  if (value("--api-rollback-plan") && !rollbackSource)
    throw new Error(
      "An API rollback plan requires explicit Cloudflare routing recovery.",
    );
  const ignored = join(ROOT, ".atlas") + sep;
  if (
    !source.startsWith(ignored) ||
    realpathSync(source) !== source ||
    (directory && (!directory.startsWith(ignored) || source === directory)) ||
    (rollbackSource &&
      (!rollbackSource.startsWith(ignored) ||
        realpathSync(rollbackSource) !== rollbackSource ||
        rollbackSource === source ||
        rollbackSource === directory))
  )
    throw new Error(
      "Separate ignored .atlas release directories without symbolic links are required.",
    );
  const runtime = loadWebRuntime(runtimeInput()),
    evidence = read(value("--evidence"));
  const records = readFileSync(value("--journal"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const inputs = {
    source,
    directory,
    runtime,
    evidence,
    records,
    rollbackSource,
    apiRollbackPlan: value("--api-rollback-plan")
      ? read(resolve(value("--api-rollback-plan")))
      : undefined,
  };
  const plan = planWebPromotion(inputs);
  if (!args.includes("--apply")) {
    console.log(
      JSON.stringify(
        {
          status: "ready",
          releaseSha: plan.manifest.releaseSha,
          architecture: plan.manifest.architecture,
          artifactDigest: plan.manifest.artifactDigest,
          assetsDigest: plan.manifest.assetsDigest,
          staging: plan.staging,
          releasePolicy: plan.releasePolicy,
          rollbackProvider: "cloudflare",
        },
        null,
        2,
      ),
    );
    return;
  }
  process.env.ATLAS_WEB_EVIDENCE_FILE = resolve(value("--evidence"));
  console.log(
    JSON.stringify(
      await promoteWebRelease({
        ...inputs,
        expected: {
          target: "production",
          hostname: value("--hostname"),
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          zoneId: process.env.CLOUDFLARE_ZONE_ID,
        },
      }),
      null,
      2,
    ),
  );
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
