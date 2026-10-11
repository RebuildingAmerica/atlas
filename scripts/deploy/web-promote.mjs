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
import { randomUUID } from "node:crypto";
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
import { captureVercelRollback } from "./web-rollback-capture.mjs";
import {
  applyRecoveryDomains,
  restoreVercelRouting,
  webRollbackOperationId,
} from "./web-rollback.mjs";
import { cloudflareCommand } from "./cloudflare-cli.mjs";
import { validateReleasePolicy } from "./web-assess.mjs";

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

export async function promoteWebRelease({
  source,
  directory,
  runtime,
  evidence,
  records,
  expected,
  token,
  hostedSecret,
  cloudflare = cloudflareCommand,
  publish = publishWebCandidate,
  capture = captureVercelRollback,
  applyDomains = applyRecoveryDomains,
  probe = probeWebRelease,
  rollback = restoreVercelRouting,
  archive = archiveWebRelease,
}) {
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
  const snapshot = await capture({ ...expected, token, cloudflare });
  prepareProductionArtifacts(source, directory, plan.manifest);
  const snapshotFile = join(directory, `rollback-vercel-${randomUUID()}.json`);
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
    rollbackSnapshotFile: snapshotFile,
    stagedWorkerVersionId: plan.candidate.workerVersionId,
  };
  production.observationJournal = join(
    directory,
    `production-observations-${production.workerVersionId}.jsonl`,
  );
  save(join(directory, "deployment.json"), production);
  archive({ directory, runtime: plan.runtime });
  // The actual staging journal must still be fresh after provisioning finishes.
  planWebPromotion({ source, runtime, evidence, records });
  const journalFile = join(directory, "routing-rollback.json");
  let journal = {
    operationId: webRollbackOperationId(snapshot, production),
    phase: "prepared",
  };
  const checkpoint = (entry) => {
    save(journalFile, entry);
    journal = entry;
  };
  checkpoint(journal);
  const recovery = {
    snapshot,
    deployment: production,
    expected,
    token,
    journal,
    checkpoint,
    cloudflare,
    applyDomains: (domains) =>
      applyDomains({ directory, deployment: production, domains }),
  };
  await rollback(recovery); // Read-only recovery check immediately before routing changes.
  try {
    await applyDomains({
      directory,
      deployment: production,
      domains: [new URL(production.candidateUrl).hostname, expected.hostname],
    });
    assertCandidateDomain(
      cloudflare(["workers", "get", production.workerName]),
      {
        workerName: production.workerName,
        hostname: expected.hostname,
        zoneId: expected.zoneId,
      },
    );
    const report = await probe({
      ...production,
      origin: production.productionUrl,
      canonicalOrigin: production.productionUrl,
      hostedSecret,
      cloudflare,
    });
    appendFileSync(
      production.observationJournal,
      JSON.stringify(report) + "\n",
      { mode: 0o600, flush: true },
    );
    if (report.status !== "pass")
      throw new Error("Immediate production probes failed.");
    production.promotionState = "active";
    save(join(directory, "deployment.json"), production);
    archive({ directory, runtime: plan.runtime });
    return {
      status: "promoted",
      productionUrl: production.productionUrl,
      workerVersionId: production.workerVersionId,
      rollbackSnapshotFile: snapshotFile,
      observationJournal: production.observationJournal,
      observationRequiredHours: plan.releasePolicy ? 0 : 72,
      releasePolicy: plan.releasePolicy,
      observationWindowWaived: Boolean(plan.releasePolicy),
    };
  } catch {
    try {
      await rollback({ ...recovery, journal, apply: true });
    } catch {
      throw new Error(
        "Production cutover failed and automatic routing recovery failed. Use the retained snapshot and routing journal for recovery.",
      );
    }
    production.promotionState = "rolled-back";
    save(join(directory, "deployment.json"), production);
    throw new Error(
      "Production cutover failed; Vercel routing was restored. Verify the restored production journeys.",
    );
  }
}

async function main() {
  const args = process.argv.slice(2),
    value = (key) =>
      args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
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
  const ignored = join(ROOT, ".atlas") + sep;
  if (
    !source.startsWith(ignored) ||
    realpathSync(source) !== source ||
    (directory && (!directory.startsWith(ignored) || source === directory))
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
  const inputs = { source, directory, runtime, evidence, records };
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
          owner: value("--owner"),
          project: value("--project"),
          team: value("--team"),
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          zoneId: process.env.CLOUDFLARE_ZONE_ID,
        },
        token: process.env.VERCEL_TOKEN,
        hostedSecret: process.env.ATLAS_HOSTED_E2E_SECRET,
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
