#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareCommand } from "./cloudflare-cli.mjs";
import {
  deployReleaseArtifact,
  releaseMessage,
  canonicalDigest,
} from "./api-cloudflare-release.mjs";
import {
  captureApiRuntimeSnapshot,
  createApiRollbackPlan,
} from "./api-runtime-rollback.mjs";
import {
  assertDurableBudget,
  assertRuntimeDeployments,
  runtimeReleaseIdentity,
} from "./web-assess.mjs";
import { digestDirectory } from "./web-release.mjs";

const ROLES = ["discovery", "api"];
const SHA = /^[a-f0-9]{40}$/,
  DIGEST = /^[a-f0-9]{64}$/;
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const output = (directory) => join(directory, ".cloudflare/output/v0");
const configFile = (directory) =>
  join(output(directory), "workers/default/worker.config.json");

export function consumerReleaseMessage(manifest, role, artifactDigest, mode) {
  const paused = releaseMessage(
    manifest.target,
    role,
    artifactDigest,
    manifest.schemaReceiptDigest,
  );
  return mode === "activate"
    ? paused.replace(
        /consumers paused$/,
        `consumers active=${manifest.releaseSha}`,
      )
    : paused;
}

function checkVersion(cf, identity, message) {
  const version = cf([
    "workers",
    "versions",
    "get",
    identity.workerVersionId,
    "--worker-id",
    identity.workerName,
  ]);
  if (
    version?.id !== identity.workerVersionId ||
    version.annotations?.["workers/tag"] !== identity.releaseSha ||
    version.annotations?.["workers/message"] !== message
  )
    throw Error(
      "Exact runtime version, commit and artifact annotations differ.",
    );
}

function checkArtifacts(manifest, artifacts) {
  const active =
    manifest.status === "verified-active" ? manifest.releaseSha : "";
  for (const role of ROLES) {
    const identity = runtimeReleaseIdentity(manifest.runtimeReleases?.[role]);
    const artifact = artifacts?.[role];
    if (
      artifact?.artifactDigest !== identity.artifactDigest ||
      digestDirectory(output(artifact?.directory ?? "")) !==
        identity.artifactDigest
    )
      throw Error(
        "Retained artifact bytes differ from the deployed runtime identity.",
      );
    const config = readJson(configFile(artifact.directory));
    if (
      readJson(join(output(artifact.directory), "config.json")).accountId !==
        manifest.accountId ||
      identity.workerName !== `atlas-${role}-${manifest.target}` ||
      identity.namespaceClass !==
        (role === "api" ? "ApiRuntime" : "DiscoveryRuntime") ||
      identity.releaseSha !== manifest.releaseSha ||
      config.name !== identity.workerName ||
      config.workersDev !== false ||
      config.previewUrls !== false ||
      (config.domains?.length ?? 0) !== 0 ||
      config.env?.ATLAS_RELEASE_SHA?.type !== "text" ||
      config.env?.ATLAS_RELEASE_SHA?.value !== manifest.releaseSha ||
      config.env?.ATLAS_ACTIVE_RELEASE_SHA?.type !== "text" ||
      config.env?.ATLAS_ACTIVE_RELEASE_SHA?.value !== active ||
      config.env?.ATLAS_SCHEMA_RECEIPT_DIGEST?.value !==
        manifest.schemaReceiptDigest ||
      config.env?.ATLAS_API_SETTINGS?.type !== "secret"
    )
      throw Error(
        "Retained artifact account, role, schema or consumer binding differs.",
      );
  }
}

function checkActivation(manifest, evidence, ownership, now) {
  if (
    evidence?.releaseSha !== manifest.releaseSha ||
    evidence?.cloudflare?.accountId !== manifest.accountId
  )
    throw Error(
      "Fresh private-validation budget preflight for this exact release is required before activation.",
    );
  assertDurableBudget(evidence, now);
  const recorded = Date.parse(ownership?.verifiedAt ?? "");
  if (
    ownership?.releaseSha !== manifest.releaseSha ||
    ownership?.accountId !== manifest.accountId ||
    ownership?.legacyWorkersStopped !== true ||
    ownership?.legacySchedulersStopped !== true ||
    typeof ownership?.evidenceReference !== "string" ||
    !ownership.evidenceReference.trim() ||
    !Number.isFinite(recorded) ||
    recorded > now ||
    now - recorded > 600_000
  )
    throw Error(
      "Fresh legacy worker and scheduler ownership handoff evidence is required.",
    );
}

/** Deploy only an activation binding change, preserving code, data and a recoverable version pair. */
export async function transitionApiConsumers({
  mode,
  manifest,
  artifacts,
  destination,
  apply = false,
  activationEvidence,
  ownership,
  verifyPrivateRuntime,
  env = process.env,
  cloudflare,
  deploy = deployReleaseArtifact,
  probe,
  checkpoint,
  now = Date.now,
}) {
  if (
    !["activate", "pause"].includes(mode) ||
    manifest?.schemaVersion !== 1 ||
    manifest.kind !== "cloudflare-api-release" ||
    !["staging", "production"].includes(manifest.target) ||
    !["verified-paused", "verified-active"].includes(manifest.status) ||
    !SHA.test(manifest.releaseSha ?? "") ||
    !DIGEST.test(manifest.schemaReceiptDigest ?? "") ||
    !/^[a-f0-9]{32}$/.test(manifest.accountId ?? "") ||
    env.CLOUDFLARE_ACCOUNT_ID !== manifest.accountId ||
    !env.CLOUDFLARE_API_TOKEN?.trim()
  )
    throw Error(
      "Explicit bearer session, account, verified release and consumer mode are required; authentication helpers are disabled.",
    );
  if (mode === "activate")
    checkActivation(manifest, activationEvidence, ownership, now());
  checkArtifacts(manifest, artifacts);
  const cf = (command, options) => {
    try {
      return (cloudflare ?? cloudflareCommand)(command, { ...options, env });
    } catch {
      throw Error(
        "cf consumer operation failed; provider diagnostics suppressed.",
      );
    }
  };
  assertRuntimeDeployments(manifest.runtimeReleases, cf);
  for (const role of ROLES)
    checkVersion(
      cf,
      manifest.runtimeReleases[role],
      consumerReleaseMessage(
        manifest,
        role,
        manifest.runtimeReleases[role].artifactDigest,
        manifest.status === "verified-active" ? "activate" : "pause",
      ),
    );
  const snapshot = captureApiRuntimeSnapshot({
    accountId: manifest.accountId,
    runtimeReleases: manifest.runtimeReleases,
    env,
    cloudflare: cf,
    now,
  });
  const result = {
    ...structuredClone(manifest),
    status: "planned",
    productionEligible: false,
    checks: [],
    eligibilityReason:
      "Private consumer state does not establish public production acceptance.",
    rollbackPlan: createApiRollbackPlan({
      snapshot,
      current: snapshot.runtimeReleases,
    }),
    previousSnapshot: snapshot,
    transition: {
      mode,
      previousStatus: manifest.status,
      preflightEvidenceDigest:
        mode === "activate" ? canonicalDigest(activationEvidence) : null,
      ownershipDigest: mode === "activate" ? canonicalDigest(ownership) : null,
    },
    artifacts: {},
  };
  if (!apply) return result;
  if (mode === "activate") {
    if (typeof verifyPrivateRuntime !== "function")
      throw Error(
        "Real private routing and Access isolation must be verified before candidate activation.",
      );
    const isolation = await verifyPrivateRuntime({ manifest });
    if (
      isolation?.private !== true ||
      isolation?.accountId !== manifest.accountId ||
      isolation?.releaseSha !== manifest.releaseSha
    )
      throw Error("Private candidate isolation readback failed.");
    result.transition.isolationDigest = canonicalDigest(isolation);
  }
  if (typeof probe !== "function" || typeof checkpoint !== "function")
    throw Error(
      "Real protected probes and durable checkpoints are required before deployment.",
    );
  if (!destination || existsSync(destination))
    throw Error(
      "A fresh retained transition directory is required; do not replay partial deployments.",
    );
  for (const role of ROLES) {
    const path = relative(
      resolve(artifacts[role].directory),
      resolve(destination),
    );
    if (!path.startsWith("..") && !path.startsWith("/"))
      throw Error(
        "Transition output must be outside retained source artifacts.",
      );
  }
  mkdirSync(destination, { recursive: true });
  const save = async (phase) =>
    checkpoint({
      schemaVersion: 1,
      phase,
      updatedAt: new Date(now()).toISOString(),
      manifest: structuredClone(result),
    });
  await save("prepared");
  try {
    for (const role of mode === "pause" ? ROLES : [...ROLES].reverse()) {
      // Recheck the pair before each write to stop on concurrent releases.
      assertRuntimeDeployments(result.runtimeReleases, cf);
      checkArtifacts(manifest, artifacts);
      const directory = join(destination, role);
      mkdirSync(directory);
      cpSync(output(artifacts[role].directory), output(directory), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      const config = readJson(configFile(directory));
      config.env.ATLAS_ACTIVE_RELEASE_SHA = {
        type: "text",
        value: mode === "activate" ? manifest.releaseSha : "",
      };
      writeFileSync(
        configFile(directory),
        JSON.stringify(config, null, 2) + "\n",
      );
      const artifact = {
        directory,
        artifactDigest: digestDirectory(output(directory)),
      };
      result.artifacts[role] = artifact;
      const message = consumerReleaseMessage(
        manifest,
        role,
        artifact.artifactDigest,
        mode,
      );
      result.uncertainDeployment = {
        role,
        expectedMessage: message,
        artifactDigest: artifact.artifactDigest,
        previousVersionId: manifest.runtimeReleases[role].workerVersionId,
      };
      await save(`deploying-${role}`);
      assertRuntimeDeployments(result.runtimeReleases, cf);
      checkArtifacts(manifest, artifacts);
      // cf beta.14's deploy keeps existing secret bindings; never rewrite settings for a binding-only transition.
      await deploy(artifact, { message, releaseSha: manifest.releaseSha, env });
      const versions = cf([
        "workers",
        "deployments",
        "list",
        "--worker",
        manifest.runtimeReleases[role].workerName,
      ])?.deployments?.[0]?.versions;
      if (
        versions?.length !== 1 ||
        versions[0].percentage !== 100 ||
        versions[0].version_id ===
          manifest.runtimeReleases[role].workerVersionId
      )
        throw Error("A new exact consumer deployment version is required.");
      const uploaded = runtimeReleaseIdentity({
        ...manifest.runtimeReleases[role],
        workerVersionId: versions[0].version_id,
        artifactDigest: artifact.artifactDigest,
      });
      checkVersion(cf, uploaded, message);
      const current = { ...result.runtimeReleases, [role]: uploaded };
      assertRuntimeDeployments(current, cf);
      result.runtimeReleases = current;
      result.rollbackPlan = createApiRollbackPlan({
        snapshot,
        current: result.runtimeReleases,
      });
      delete result.uncertainDeployment;
      await save(`deployed-${role}`);
      assertRuntimeDeployments(result.runtimeReleases, cf);
      await probeRuntime(role);
    }
    for (const role of ROLES) await probeRuntime(role);
    assertRuntimeDeployments(result.runtimeReleases, cf);
    result.retainedSnapshot = captureApiRuntimeSnapshot({
      accountId: manifest.accountId,
      runtimeReleases: result.runtimeReleases,
      env,
      cloudflare: cf,
      now,
    });
    result.status = mode === "activate" ? "verified-active" : "verified-paused";
    result.verifiedAt = new Date(now()).toISOString();
    await save(result.status);
    return result;
  } catch (error) {
    if (result.uncertainDeployment) {
      try {
        const { role, artifactDigest, expectedMessage, previousVersionId } =
          result.uncertainDeployment;
        const versions = cf([
          "workers",
          "deployments",
          "list",
          "--worker",
          manifest.runtimeReleases[role].workerName,
        ])?.deployments?.[0]?.versions;
        if (
          versions?.length === 1 &&
          versions[0].percentage === 100 &&
          versions[0].version_id !== previousVersionId
        ) {
          const uploaded = runtimeReleaseIdentity({
            ...manifest.runtimeReleases[role],
            workerVersionId: versions[0].version_id,
            artifactDigest,
          });
          checkVersion(cf, uploaded, expectedMessage);
          const current = { ...result.runtimeReleases, [role]: uploaded };
          assertRuntimeDeployments(current, cf);
          result.runtimeReleases = current;
          result.rollbackPlan = createApiRollbackPlan({ snapshot, current });
          delete result.uncertainDeployment;
        }
      } catch {
        /* Retain the explicit uncertain role; recovery must read it back before restoring versions. */
      }
    }
    result.status = "verification-required";
    await save("verification-required");
    throw error;
  }
  async function probeRuntime(role) {
    for (const path of ["/__atlas/release", "/__atlas/consumers", "/health"]) {
      let response;
      try {
        response = await probe({ role, path, releaseSha: manifest.releaseSha });
      } catch {
        throw Error(
          "Protected consumer reconciliation probe failed; private diagnostics suppressed.",
        );
      }
      if (
        response?.status !== 200 ||
        (path === "/__atlas/release" &&
          (response.body?.releaseSha !== manifest.releaseSha ||
            response.body?.runtimeRole !== role ||
            response.body?.schemaReceiptDigest !==
              manifest.schemaReceiptDigest)) ||
        (path === "/__atlas/consumers" &&
          (response.body?.releaseSha !== manifest.releaseSha ||
            response.body?.activeReleaseSha !==
              (mode === "activate" ? manifest.releaseSha : "") ||
            response.body?.enabled !== (mode === "activate")))
      )
        throw Error(
          "Protected exact-release consumer reconciliation probe failed.",
        );
      result.checks.push({ role, path, status: "pass" });
    }
  }
}

/** Resolve an ambiguous write with provider reads only, preparing the existing version rollback helper. */
export async function reconcileConsumerJournal({
  journal,
  env = process.env,
  cloudflare,
  checkpoint,
}) {
  const manifest = structuredClone(journal?.manifest);
  if (
    journal?.schemaVersion !== 1 ||
    manifest?.kind !== "cloudflare-api-release" ||
    !["planned", "verification-required"].includes(manifest.status) ||
    ![
      "prepared",
      "deploying-api",
      "deploying-discovery",
      "deployed-api",
      "deployed-discovery",
      "verification-required",
      "reconciled-for-rollback",
    ].includes(journal.phase) ||
    !["activate", "pause"].includes(manifest.transition?.mode) ||
    !["verified-active", "verified-paused"].includes(
      manifest.transition?.previousStatus,
    ) ||
    !SHA.test(manifest.releaseSha ?? "") ||
    !DIGEST.test(manifest.schemaReceiptDigest ?? "") ||
    env.CLOUDFLARE_ACCOUNT_ID !== manifest.accountId ||
    !env.CLOUDFLARE_API_TOKEN?.trim() ||
    typeof checkpoint !== "function"
  )
    throw Error(
      "A retained uncertain journal, explicit bearer session and checkpoint are required.",
    );
  // This also validates the original immutable snapshot digest before provider operations.
  createApiRollbackPlan({
    snapshot: manifest.previousSnapshot,
    current: manifest.runtimeReleases,
  });
  const cf = (command, options) => {
    try {
      return (cloudflare ?? cloudflareCommand)(command, { ...options, env });
    } catch {
      throw Error(
        "cf consumer reconciliation failed; provider diagnostics suppressed.",
      );
    }
  };
  const current = {};
  for (const role of ROLES) {
    const previous = manifest.previousSnapshot.runtimeReleases[role];
    const versions = cf([
      "workers",
      "deployments",
      "list",
      "--worker",
      previous.workerName,
    ])?.deployments?.[0]?.versions;
    if (versions?.length !== 1 || versions[0].percentage !== 100)
      throw Error("One exact runtime version is required for reconciliation.");
    if (versions[0].version_id === previous.workerVersionId) {
      checkVersion(
        cf,
        previous,
        consumerReleaseMessage(
          manifest,
          role,
          previous.artifactDigest,
          manifest.transition.previousStatus === "verified-active"
            ? "activate"
            : "pause",
        ),
      );
      current[role] = previous;
      continue;
    }
    const artifact = manifest.artifacts?.[role];
    if (
      !DIGEST.test(artifact?.artifactDigest ?? "") ||
      digestDirectory(output(artifact.directory)) !== artifact.artifactDigest
    )
      throw Error(
        "The attempted artifact must remain intact before reconciling its upload.",
      );
    const identity = runtimeReleaseIdentity({
      ...previous,
      workerVersionId: versions[0].version_id,
      artifactDigest: artifact.artifactDigest,
    });
    checkVersion(
      cf,
      identity,
      consumerReleaseMessage(
        manifest,
        role,
        artifact.artifactDigest,
        manifest.transition.mode,
      ),
    );
    current[role] = identity;
  }
  assertRuntimeDeployments(current, cf);
  manifest.runtimeReleases = current;
  manifest.status = "verification-required";
  manifest.rollbackPlan = createApiRollbackPlan({
    snapshot: manifest.previousSnapshot,
    current,
  });
  delete manifest.uncertainDeployment;
  // A successful identity readback is not proof that work drained or that product journeys passed.
  await checkpoint({
    schemaVersion: 1,
    phase: "reconciled-for-rollback",
    manifest,
  });
  return manifest;
}

function privateJson(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw Error("Settings and Access files must be owner-only regular files.");
  return readJson(file);
}

function atomicJournal(file, journal) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(journal, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function consumerCli(
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
  if (args.includes("--reconcile-journal")) {
    const file = resolve(option("--output"));
    if (existsSync(file))
      throw Error("Use a fresh reconciliation output path.");
    const result = await reconcileConsumerJournal({
      journal: readJson(resolve(option("--reconcile-journal"))),
      env,
      checkpoint: async (journal) =>
        writeFileSync(file, JSON.stringify(journal, null, 2) + "\n", {
          mode: 0o600,
          flag: "wx",
        }),
    });
    console.log(
      JSON.stringify({
        status: "reconciled-for-rollback",
        releaseSha: result.releaseSha,
        productionEligible: false,
      }),
    );
    return result;
  }
  const manifest = readJson(resolve(option("--manifest"))),
    mode = option("--mode"),
    destination = resolve(option("--directory"));
  const artifacts = Object.fromEntries(
    ROLES.map((role) => [
      role,
      {
        directory: resolve(option(`--${role}-artifact`)),
        artifactDigest: manifest.runtimeReleases?.[role]?.artifactDigest,
      },
    ]),
  );
  const apply = args.includes("--apply");
  let probe, verifyPrivateRuntime;
  if (apply) {
    const { assertAccessPolicy, assertCandidateDomain } =
      await import("./web-candidate.mjs");
    const access = privateJson(resolve(option("--access-file"))),
      hostname = option("--operations-hostname");
    if (
      !access.id ||
      !access.client_id ||
      !access.client_secret ||
      hostname !== manifest.operations?.hostname ||
      !hostname.startsWith(`atlas-api-ops-${manifest.target}.`)
    )
      throw Error(
        "Retained operations hostname and existing Access service credentials are required.",
      );
    if (!env.CLOUDFLARE_API_TOKEN?.trim())
      throw Error(
        "An explicit bearer session is required; authentication helpers are disabled.",
      );
    const cf = (command) => cloudflareCommand(command, { env });
    const policy = cf([
      "zero-trust",
      "access",
      "applications",
      "get",
      manifest.operations.accessAppId,
    ]);
    assertAccessPolicy(policy, policy.policies, hostname, access.id);
    assertCandidateDomain(
      cf(["workers", "get", manifest.operations.workerName]),
      {
        workerName: `atlas-api-ops-${manifest.target}`,
        hostname,
        zoneId: option("--zone-id"),
      },
    );
    const denied = await fetch(`https://${hostname}/api/health`, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (denied.status !== 403)
      throw Error("Operations Access denial must pass before deployment.");
    verifyPrivateRuntime = async () => {
      for (const role of ROLES) {
        const worker = cf([
          "workers",
          "get",
          manifest.runtimeReleases[role].workerName,
        ]);
        if (
          worker.name !== manifest.runtimeReleases[role].workerName ||
          !Array.isArray(worker.references?.domains) ||
          worker.references.domains.length !== 0 ||
          !Array.isArray(worker.references?.routes) ||
          worker.references.routes.length !== 0
        )
          throw Error(
            "API/discovery must have no public domains or routes before private activation.",
          );
      }
      return {
        private: true,
        accountId: manifest.accountId,
        releaseSha: manifest.releaseSha,
        operationsAccessAppId: manifest.operations.accessAppId,
      };
    };
    probe = async ({ role, path }) => {
      const response = await fetch(`https://${hostname}/${role}${path}`, {
        headers: {
          "CF-Access-Client-Id": access.client_id,
          "CF-Access-Client-Secret": access.client_secret,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      return {
        status: response.status,
        body: response.status === 200 ? await response.json() : null,
      };
    };
  }
  const result = await transitionApiConsumers({
    mode,
    manifest,
    artifacts,
    destination,
    apply,
    env,
    probe,
    verifyPrivateRuntime,
    ...(mode === "activate"
      ? {
          activationEvidence: readJson(resolve(option("--preflight"))),
          ownership: readJson(resolve(option("--ownership"))),
        }
      : {}),
    checkpoint: async (journal) =>
      atomicJournal(join(destination, "consumer-journal.json"), journal),
  });
  if (apply)
    writeFileSync(
      join(destination, "api-release.json"),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
  console.log(
    JSON.stringify({
      status: result.status,
      mode,
      releaseSha: result.releaseSha,
      productionEligible: false,
    }),
  );
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  consumerCli().catch(() => {
    console.error(
      "Consumer deployment failed; inspect the retained journal. Private diagnostics suppressed.",
    );
    process.exitCode = 1;
  });
}
