#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { cloudflareCommand as cf } from "./cloudflare-cli.mjs";
import {
  assertAccessPolicy,
  assertCandidateDomain,
  loadWebRuntime,
} from "./web-candidate.mjs";
import { prepareCloudflareOutput } from "./web-cloudflare-output.mjs";
import {
  copyWebArtifact,
  digestDirectory,
  WEB_PUBLIC_ENV_KEYS,
  webBuildEnvironment,
} from "./web-release.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const arg = (args, key) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
function json(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(
      `${label} must be a readable JSON file; values were suppressed.`,
    );
  }
}

/** Keep the alternative CPU experiment away from production and release manifests. */
export function validateEvaluationDestination({
  workerName,
  hostname,
  canonicalUrl,
}) {
  if (
    !/^atlas-durable-eval-[a-z0-9-]+$/.test(workerName ?? "") ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(hostname ?? "") ||
    !hostname.startsWith(workerName + ".")
  )
    throw new Error(
      "An atlas-durable-eval-* Worker and matching isolated hostname are required.",
    );
  if (!canonicalUrl || !hostname.endsWith("." + new URL(canonicalUrl).hostname))
    throw new Error(
      "The evaluation hostname must be a descendant of Atlas's canonical production hostname.",
    );
}

export function validateEvaluationDatabase(hyperdrive, databaseUrl) {
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

export function assertEvaluationVersion(deployments) {
  const versions = deployments?.deployments?.[0]?.versions;
  if (
    !Array.isArray(versions) ||
    versions.length !== 1 ||
    versions[0].percentage !== 100 ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(
      versions[0].version_id ?? "",
    )
  )
    throw new Error(
      "Evaluation requires exactly one immutable version at 100% traffic.",
    );
  return versions[0].version_id;
}

/** Persist the actual deployment even while DNS or TLS provisioning is pending. */
export async function verifyEvaluation(
  file,
  evidence,
  access,
  fetcher = fetch,
) {
  const pending = { ...evidence, verification: "pending" };
  writeFileSync(file, JSON.stringify(pending, null, 2) + "\n");
  const origin = "https://" + evidence.hostname;
  try {
    const session = await fetcher(origin + "/api/auth/get-session", {
      headers: {
        "CF-Access-Client-Id": access.client_id,
        "CF-Access-Client-Secret": access.client_secret,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (
      session.status !== 200 ||
      (await session.text()) !== "null" ||
      session.headers.get("cache-control") !== "private, no-store"
    )
      throw new Error("Session control failed.");
    const denied = await fetcher(origin, {
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (denied.status !== 403) throw new Error("Access control failed.");
  } catch {
    throw new Error(
      "Evaluation deployed; hosted verification is pending. Retry with --verify-file and --access-file after DNS/TLS provisioning. Details remain private.",
    );
  }
  const verified = {
    ...pending,
    verification: "anonymous-session-and-access",
    checkedAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(verified, null, 2) + "\n");
  console.log(JSON.stringify(verified));
  return verified;
}

export async function evaluate(args) {
  const verifyFile = arg(args, "--verify-file");
  if (verifyFile) {
    const evidence = json(verifyFile, "Evaluation evidence");
    if (
      evidence.kind !== "durable-evaluation" ||
      evidence.productionEligible !== false
    )
      throw new Error("Only diagnostic evaluation evidence can be verified.");
    validateEvaluationDestination(evidence);
    const access = json(arg(args, "--access-file"), "Access credentials");
    const application = cf([
      "zero-trust",
      "access",
      "applications",
      "get",
      evidence.accessAppId,
    ]);
    assertAccessPolicy(
      application,
      application.policies,
      evidence.hostname,
      access.id,
    );
    const live = cf([
      "workers",
      "deployments",
      "list",
      "--worker",
      evidence.workerName,
    ]);
    if (
      assertEvaluationVersion(live) !==
      assertEvaluationVersion(evidence.deployments)
    )
      throw new Error(
        "Evaluation deployment changed; refusing to verify another version.",
      );
    if (!/^[a-f0-9]{32}$/.test(evidence.zoneId ?? ""))
      throw new Error("Evaluation domain zone identity is required.");
    assertCandidateDomain(cf(["workers", "get", evidence.workerName]), {
      workerName: evidence.workerName,
      hostname: evidence.hostname,
      zoneId: evidence.zoneId,
    });
    return verifyEvaluation(verifyFile, evidence, access);
  }
  const runtime = loadWebRuntime(
    JSON.stringify(json(arg(args, "--runtime-file"), "Runtime")),
  );
  const access = json(arg(args, "--access-file"), "Access credentials");
  const workerName = arg(args, "--worker-name"),
    hostname = arg(args, "--hostname");
  const hyperdriveId = arg(args, "--hyperdrive-id");
  const apiWorker = arg(args, "--api-worker");
  if (apiWorker && apiWorker !== "atlas-python-eval-api")
    throw new Error("The protected Atlas API evaluation binding is required.");
  const apiVersionId = apiWorker
    ? assertEvaluationVersion(
        cf(["workers", "deployments", "list", "--worker", apiWorker]),
      )
    : undefined;
  const canonicalUrl =
    runtime.ATLAS_WEB_CANONICAL_URL ?? runtime.ATLAS_PUBLIC_URL;
  validateEvaluationDestination({ workerName, hostname, canonicalUrl });
  if (
    !/^[a-f0-9]{32}$/.test(hyperdriveId ?? "") ||
    !access.id ||
    !access.client_id ||
    !access.client_secret
  )
    throw new Error(
      "An existing Hyperdrive and Atlas Access service token are required.",
    );
  if (
    execFileSync("git", ["status", "--porcelain"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim()
  )
    throw new Error("Commit the evaluation source before hosted deployment.");
  const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const subscriptions = cf(["accounts", "subscriptions", "get"]);
  if (
    !Array.isArray(subscriptions) ||
    subscriptions.some(
      (s) =>
        /workers/i.test(s.rate_plan?.id ?? "") && !/free/i.test(s.rate_plan.id),
    )
  )
    throw new Error("Evaluation requires an account on Workers Free.");
  const hyperdrive = cf(["hyperdrive", "get", hyperdriveId]);
  validateEvaluationDatabase(hyperdrive, runtime.DATABASE_URL);
  const apps = cf(["zero-trust", "access", "applications", "list"]);
  const application =
    apps.find((a) => a.domain === hostname) ??
    cf(["zero-trust", "access", "applications", "create"], {
      body: {
        name: workerName,
        type: "self_hosted",
        domain: hostname,
        session_duration: "24h",
        policies: [
          {
            name: "Atlas hosted evaluation",
            decision: "non_identity",
            include: [{ service_token: { token_id: access.id } }],
          },
        ],
      },
    });
  assertAccessPolicy(
    application,
    cf(["zero-trust", "access", "applications", "get", application.id])
      .policies,
    hostname,
    access.id,
  );
  const directory = join(ROOT, ".atlas/web/durable-evaluation", releaseSha);
  mkdirSync(directory, { recursive: true });
  const buildEnv = webBuildEnvironment(
    Object.fromEntries(
      WEB_PUBLIC_ENV_KEYS.filter((k) => runtime[k] !== undefined).map((k) => [
        k,
        runtime[k],
      ]),
    ),
  );
  const build = spawnSync(
    "pnpm",
    ["--filter", "@rebuildingamerica/atlas-app", "run", "build:workers"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ...buildEnv,
        ATLAS_WORKERS_EXECUTION: "durable-evaluation",
      },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  writeFileSync(
    join(directory, "build-private.log"),
    (build.stdout ?? "") + (build.stderr ?? ""),
    { mode: 0o600 },
  );
  if (build.error || build.status !== 0)
    throw new Error(
      "Evaluation build failed; private diagnostic log retained.",
    );
  const source = join(ROOT, "app/.cloudflare/output/v0");
  rmSync(join(directory, "artifact"), { recursive: true, force: true });
  copyWebArtifact(source, join(directory, "artifact"));
  rmSync(join(directory, "assets"), { recursive: true, force: true });
  cpSync(join(source, "workers/default/assets"), join(directory, "assets"), {
    recursive: true,
  });
  runtime.ATLAS_WEB_CANONICAL_URL = canonicalUrl;
  runtime.ATLAS_PASSKEY_RP_ID ||= new URL(canonicalUrl).hostname;
  runtime.ATLAS_PUBLIC_URL = "https://" + hostname;
  runtime.ATLAS_AUTH_API_KEY_INTROSPECTION_URL =
    runtime.ATLAS_PUBLIC_URL + "/api/auth/internal/api-key";
  const workerEnv = Object.fromEntries(
    WEB_PUBLIC_ENV_KEYS.filter((k) => runtime[k] !== undefined).map((k) => [
      k,
      { type: "text", value: runtime[k] },
    ]),
  );
  workerEnv.HYPERDRIVE = { type: "hyperdrive", id: hyperdriveId };
  if (apiWorker)
    workerEnv.API_RUNTIME = {
      type: "durable-object",
      worker: apiWorker,
      exportName: "ApiRuntime",
    };
  workerEnv.APP_RUNTIME = {
    type: "durable-object",
    worker: workerName,
    exportName: "AtlasAppRuntime",
  };
  workerEnv.ATLAS_AUTH_MIGRATIONS = { type: "text", value: "external" };
  workerEnv.ATLAS_RELEASE_SHA = { type: "text", value: releaseSha };
  const secrets = Object.fromEntries(
    Object.entries(runtime).filter(
      ([k]) =>
        !WEB_PUBLIC_ENV_KEYS.includes(k) &&
        ![
          "DATABASE_URL",
          "ATLAS_AUTH_MIGRATIONS",
          "ATLAS_RELEASE_SHA",
          "ATLAS_WORKERS_EXECUTION",
        ].includes(k),
    ),
  );
  for (const k of Object.keys(secrets)) workerEnv[k] = { type: "secret" };
  const temp = mkdtempSync(join(tmpdir(), "atlas-durable-evaluation-"));
  try {
    await prepareCloudflareOutput({
      directory,
      architecture: "workers",
      outputRoot: temp,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      workerName,
      workerEnv,
      hostname,
    });
    const secretFile = join(temp, "secrets.json");
    writeFileSync(secretFile, JSON.stringify(secrets), { mode: 0o600 });
    const deploy = spawnSync(
      process.execPath,
      [
        join(ROOT, "node_modules/cf/bin/cf"),
        "deploy",
        "--prebuilt",
        "--secrets-file",
        secretFile,
        "--tag",
        releaseSha,
        "--message",
        "Protected Atlas Durable Object evaluation; no production release",
        "--mode",
        "production",
        ...(process.env.ATLAS_CF_PROFILE
          ? ["--profile", process.env.ATLAS_CF_PROFILE]
          : []),
      ],
      {
        cwd: temp,
        env: process.env,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    writeFileSync(
      join(directory, "deploy-private.log"),
      (deploy.stdout ?? "") + (deploy.stderr ?? ""),
      { mode: 0o600 },
    );
    if (deploy.error || deploy.status !== 0)
      throw new Error(
        "Evaluation deployment failed; private diagnostic log retained.",
      );
    const deployments = cf([
      "workers",
      "deployments",
      "list",
      "--worker",
      workerName,
    ]);
    assertEvaluationVersion(deployments);
    const worker = cf(["workers", "get", workerName]);
    const zoneId = worker.references?.domains?.find(
      (domain) => domain.hostname === hostname,
    )?.zone_id;
    if (!/^[a-f0-9]{32}$/.test(zoneId ?? ""))
      throw new Error("Evaluation domain zone identity is required.");
    assertCandidateDomain(worker, { workerName, hostname, zoneId });
    const namespaces = cf(["durable-objects", "namespaces", "list"]);
    const namespace = namespaces.find(
      (n) => n.script === workerName && n.class === "AtlasAppRuntime",
    );
    if (namespace?.use_sqlite !== true)
      throw new Error("SQLite-backed evaluation namespace was not confirmed.");
    const evidence = {
      kind: "durable-evaluation",
      productionEligible: false,
      releaseSha,
      workerName,
      hostname,
      canonicalUrl,
      ...(apiWorker ? { apiWorker, apiVersionId } : {}),
      zoneId,
      artifactDigest: digestDirectory(join(directory, "artifact")),
      assetsDigest: digestDirectory(join(directory, "assets")),
      namespaceId: namespace.id,
      accessAppId: application.id,
      deployments,
      deployedAt: new Date().toISOString(),
    };
    await verifyEvaluation(
      join(directory, "evaluation.json"),
      evidence,
      access,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  evaluate(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
