#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  cpSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  evaluateRepositoryCostPosture,
  evaluateCloudRunCostPosture,
} from "./cloud-cost-policy.mjs";
import { forecastMonthlyCost, assessMigration } from "./web-migration.mjs";
import {
  createWebManifest,
  digestDirectory,
  verifyWebManifest,
} from "./web-release.mjs";

import { cloudflareCommand } from "./cloudflare-cli.mjs";
import { prepareCloudflareOutput } from "./web-cloudflare-output.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

/** Confirm the protected URL actually serves this release before recording success. */
export function assertCandidateDomain(
  worker,
  { workerName, hostname, zoneId },
) {
  if (
    worker?.name !== workerName ||
    !worker.references?.domains?.some(
      (domain) => domain.hostname === hostname && domain.zone_id === zoneId,
    )
  )
    throw new Error("Candidate domain readback failed.");
}

export function runtimeInput() {
  return process.env.ATLAS_WEB_RUNTIME_FILE
    ? readFileSync(process.env.ATLAS_WEB_RUNTIME_FILE, "utf8")
    : required("ATLAS_WEB_RUNTIME_ENV_JSON");
}

const PUBLIC_KEYS = [
  "ATLAS_MANAGED",
  "ATLAS_MULTI_USER",
  "ATLAS_PUBLIC_URL",
  "ATLAS_DOCS_URL",
  "ATLAS_AUTH_BASE_PATH",
  "ATLAS_SERVER_API_PROXY_TARGET",
  "ATLAS_AUTH_JWT_AUDIENCES",
];
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function tool(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${binary} failed; provider output was suppressed to protect credentials.`,
    );
  return result.stdout?.trim() ?? "";
}

export function loadWebRuntime(raw) {
  const env = JSON.parse(raw);
  if (!env || typeof env !== "object" || Array.isArray(env))
    throw new Error("Runtime must be a JSON object.");
  for (const [key, value] of Object.entries(env)) {
    if (
      !/^(?:ATLAS_[A-Z0-9_]+|STRIPE_[A-Z0-9_]+|DATABASE_URL|DATABASE_BACKEND|NODE_ENV)$/.test(
        key,
      ) ||
      typeof value !== "string"
    )
      throw new Error(
        "Runtime includes an unsupported key or non-string value.",
      );
  }
  for (const key of [
    "ATLAS_PUBLIC_URL",
    "ATLAS_SERVER_API_PROXY_TARGET",
    "ATLAS_AUTH_INTERNAL_SECRET",
    "DATABASE_URL",
    "ATLAS_EMAIL_RESEND_API_KEY",
    "ATLAS_AUTH_JWT_AUDIENCES",
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
  ])
    if (!env[key]?.trim()) throw new Error(`Runtime ${key} is required.`);
  for (const key of [
    "ATLAS_PUBLIC_URL",
    "ATLAS_SERVER_API_PROXY_TARGET",
    ...(env.ATLAS_WEB_CANONICAL_URL ? ["ATLAS_WEB_CANONICAL_URL"] : []),
  ]) {
    const url = new URL(env[key]);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error(`${key} must be a clean HTTPS origin.`);
  }
  if (!env.DATABASE_URL.startsWith("postgres"))
    throw new Error("Hosted runtime requires PostgreSQL.");
  if (env.ATLAS_MANAGED !== "true" || env.ATLAS_MULTI_USER !== "true")
    throw new Error(
      "Managed candidates must preserve accounts and workspaces.",
    );
  if (
    env.ATLAS_AUTH_JWT_AUDIENCES.split(",")[0] !==
    (env.ATLAS_WEB_CANONICAL_URL ?? env.ATLAS_PUBLIC_URL).replace(/\/$/, "") +
      "/mcp"
  )
    throw new Error("Canonical MCP audience mismatch.");
  return env;
}

/** Candidate host is a descendant of the canonical host so existing RP IDs stay valid. */
export function candidateRuntime(runtime, target, architecture, sha, zoneName) {
  const canonical = new URL(runtime.ATLAS_PUBLIC_URL);
  if (runtime.ATLAS_WEB_CANONICAL_URL)
    throw new Error(
      "Candidate runtime must be derived from the original canonical runtime.",
    );
  if (
    canonical.hostname !== zoneName &&
    !canonical.hostname.endsWith("." + zoneName)
  )
    throw new Error(
      "Canonical hostname is outside the selected Cloudflare zone.",
    );
  const name = createWebManifest({
    target,
    architecture,
    releaseSha: sha,
  }).workerName;
  const candidate = `https://${name}.${canonical.hostname}`;
  return {
    ...runtime,
    ATLAS_WEB_CANONICAL_URL: canonical.origin,
    ATLAS_PUBLIC_URL: candidate,
    ATLAS_PASSKEY_RP_ID: runtime.ATLAS_PASSKEY_RP_ID || canonical.hostname,
    ATLAS_AUTH_JWT_AUDIENCES: runtime.ATLAS_AUTH_JWT_AUDIENCES,
    ATLAS_AUTH_API_KEY_INTROSPECTION_URL:
      candidate + "/api/auth/internal/api-key",
  };
}

async function prepareCandidateRuntime(target, architecture, file) {
  const original = loadWebRuntime(required("ATLAS_WEB_RUNTIME_ENV_JSON"));
  const zone = cloudflareCommand([
    "zones",
    "get",
    "--zone",
    required("CLOUDFLARE_ZONE_ID"),
  ]);
  const runtime = candidateRuntime(
    original,
    target,
    architecture,
    tool("git", ["rev-parse", "HEAD"]),
    zone.name,
  );
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(runtime), { mode: 0o600 });
  console.log(
    "Candidate runtime prepared with the original signing secrets and passkey RP ID.",
  );
}

export function assertCandidateBudget(evidence, architecture) {
  const assessment = assessMigration(evidence);
  if (!assessment.alternatives.workers)
    throw new Error(
      "A complete measured 14-day baseline and account quota inventory are required before candidate provisioning.",
    );
  if (
    Object.values(assessment.alternatives).some(
      (candidate) => candidate.currentForecastUsd === null,
    )
  )
    throw new Error(
      "Measured cost forecasts for both alternatives are required before provisioning.",
    );
  const end = Date.parse(evidence.baseline.windowEnd ?? "");
  if (
    !Number.isFinite(end) ||
    Date.now() - end > 48 * 3600_000 ||
    end > Date.now()
  )
    throw new Error("Baseline must end within the last 48 hours.");
  if (architecture === "hybrid" && forecastMonthlyCost(evidence.hybrid, 2) > 5)
    throw new Error(
      "Candidate forecast exceeds $5/month at twice current traffic.",
    );
}

async function ensureFreeAccount() {
  const subscriptions = cloudflareCommand(["accounts", "subscriptions", "get"]);
  if (!Array.isArray(subscriptions))
    throw new Error("Cloudflare subscription inventory is unavailable.");
  if (
    subscriptions.some(
      (item) =>
        /workers/i.test(item.rate_plan?.id ?? "") &&
        !/free/i.test(item.rate_plan.id),
    )
  )
    throw new Error("Paid Workers accounts are outside the migration budget.");
}

async function ensureHyperdrive(target, runtime) {
  const name = `atlas-auth-${target}`;
  const db = new URL(runtime.DATABASE_URL);
  const configs = cloudflareCommand(["hyperdrive", "list"]);
  const existing = configs.find((item) => item.name === name);
  if (existing) {
    const current = cloudflareCommand(["hyperdrive", "get", existing.id]);
    if (current.caching?.disabled !== true)
      throw new Error(
        "Existing auth Hyperdrive must have query caching disabled.",
      );
    if (
      current.origin?.host !== db.hostname ||
      current.origin?.database !== decodeURIComponent(db.pathname.slice(1)) ||
      current.origin?.user !== decodeURIComponent(db.username) ||
      current.origin?.port !== Number(db.port || 5432)
    )
      throw new Error(
        "Existing Hyperdrive points to a different auth database.",
      );
    return existing.id;
  }
  const created = cloudflareCommand(["hyperdrive", "create"], {
    body: {
      name,
      caching: { disabled: true },
      origin: {
        scheme: "postgres",
        host: db.hostname,
        port: Number(db.port || 5432),
        database: decodeURIComponent(db.pathname.slice(1)),
        user: decodeURIComponent(db.username),
        password: decodeURIComponent(db.password),
      },
    },
  });
  if (created.caching?.disabled !== true || !created.id)
    throw new Error(
      "Hyperdrive creation did not confirm disabled query caching.",
    );
  return created.id;
}

export function assertAccessPolicy(app, policies, hostname, tokenId) {
  if (
    app.type !== "self_hosted" ||
    app.domain !== hostname ||
    policies.length !== 1 ||
    policies[0].decision !== "non_identity" ||
    policies[0].include?.length !== 1 ||
    Object.keys(policies[0].include[0]).length !== 1 ||
    policies[0].include[0].service_token?.token_id !== tokenId ||
    (policies[0].exclude?.length ?? 0) !== 0 ||
    (policies[0].require?.length ?? 0) !== 0
  )
    throw new Error(
      "Candidate Access policy differs from its exclusive service-token grant.",
    );
}

async function protectCandidate(hostname, name) {
  const tokenId = required("ATLAS_CF_ACCESS_SERVICE_TOKEN_ID");
  required("ATLAS_HOSTED_CF_ACCESS_CLIENT_ID");
  required("ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET");
  const apps = cloudflareCommand([
    "zero-trust",
    "access",
    "applications",
    "list",
  ]);
  const existing = apps.find((item) => item.domain === hostname);
  const app =
    existing ??
    cloudflareCommand(["zero-trust", "access", "applications", "create"], {
      body: {
        name,
        type: "self_hosted",
        domain: hostname,
        session_duration: "24h",
        policies: [
          {
            name: "Atlas hosted verification",
            decision: "non_identity",
            include: [{ service_token: { token_id: tokenId } }],
          },
        ],
      },
    });
  if (!app.id || app.domain !== hostname)
    throw new Error("Access application protection was not confirmed.");
  const policies = cloudflareCommand([
    "zero-trust",
    "access",
    "applications",
    "get",
    app.id,
  ]).policies;
  assertAccessPolicy(app, policies, hostname, tokenId);
  return app.id;
}

async function exposeAtprotoMetadata(hostname, name) {
  const domain = hostname + "/api/atproto/oauth/client-metadata.json";
  const apps = cloudflareCommand([
    "zero-trust",
    "access",
    "applications",
    "list",
  ]);
  const existing = apps.find((item) => item.domain === domain);
  const app =
    existing ??
    cloudflareCommand(["zero-trust", "access", "applications", "create"], {
      body: {
        name: name + " public ATProto metadata",
        type: "self_hosted",
        domain,
        policies: [
          {
            name: "Public OAuth client metadata",
            decision: "bypass",
            include: [{ everyone: {} }],
          },
        ],
      },
    });
  const policies = cloudflareCommand([
    "zero-trust",
    "access",
    "applications",
    "get",
    app.id,
  ]).policies;
  if (
    app.domain !== domain ||
    app.type !== "self_hosted" ||
    policies.length !== 1 ||
    policies[0].decision !== "bypass" ||
    policies[0].include?.length !== 1 ||
    !policies[0].include[0].everyone ||
    Object.keys(policies[0].include[0]).length !== 1
  )
    throw new Error("Public ATProto metadata policy readback failed.");
}

async function bootstrapAccess(target) {
  const file = join(ROOT, ".atlas/web", `access-${target}.json`);
  mkdirSync(resolve(file, ".."), { recursive: true });
  let token;
  if (existsSync(file)) token = JSON.parse(readFileSync(file, "utf8"));
  else {
    token = cloudflareCommand(
      ["zero-trust", "access", "service-tokens", "create"],
      {
        body: {
          name: `Atlas ${target} hosted verification`,
          duration: "8760h",
        },
      },
    );
    if (!token.id || !token.client_id || !token.client_secret)
      throw new Error("Access token creation returned incomplete credentials.");
    writeFileSync(file, JSON.stringify(token), { mode: 0o600 });
  }
  for (const [key, value] of Object.entries({
    ATLAS_CF_ACCESS_SERVICE_TOKEN_ID: token.id,
    ATLAS_HOSTED_CF_ACCESS_CLIENT_ID: token.client_id,
    ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET: token.client_secret,
  })) {
    tool(
      "gh",
      [
        "secret",
        "set",
        key,
        "--repo",
        "RebuildingAmerica/atlas",
        "--env",
        target,
      ],
      { input: value },
    );
  }
  console.log(
    "Cloudflare Access service credentials synchronized to the target GitHub environment.",
  );
}

async function publish(directory, target, architecture) {
  const runtime = loadWebRuntime(runtimeInput());
  const evidence = JSON.parse(
    readFileSync(required("ATLAS_WEB_EVIDENCE_FILE"), "utf8"),
  );
  assertCandidateBudget(evidence, architecture);
  if (evidence.cloudflare.accountId !== required("CLOUDFLARE_ACCOUNT_ID"))
    throw new Error(
      "Quota evidence belongs to a different Cloudflare account.",
    );
  await ensureFreeAccount();
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.target !== target || manifest.architecture !== architecture)
    throw new Error("Candidate target/architecture mismatch.");
  // Hybrid identity is filled only after the pinned revision is deployed.
  const observed = {
    releaseSha: tool("git", ["rev-parse", "HEAD"]),
    artifactDigest: digestDirectory(join(directory, "artifact")),
    assetsDigest: digestDirectory(join(directory, "assets")),
  };
  if (
    manifest.sourceDirty !== false ||
    manifest.releaseSha !== observed.releaseSha ||
    manifest.artifactDigest !== observed.artifactDigest ||
    manifest.assetsDigest !== observed.assetsDigest ||
    tool("git", ["status", "--porcelain"])
  )
    throw new Error(
      "Candidate artifacts must match a clean committed source tree.",
    );
  for (const key of PUBLIC_KEYS)
    if ((manifest.publicEnv[key] ?? "") !== (runtime[key] ?? ""))
      throw new Error(`Candidate build-time ${key} differs from runtime.`);
  const zone = required("CLOUDFLARE_ZONE_ID");
  const zoneInfo = cloudflareCommand(["zones", "get", "--zone", zone]);
  const canonical = new URL(runtime.ATLAS_WEB_CANONICAL_URL ?? "");
  const hostname = `${manifest.workerName}.${canonical.hostname}`;
  if (
    (canonical.hostname !== zoneInfo.name &&
      !canonical.hostname.endsWith("." + zoneInfo.name)) ||
    runtime.ATLAS_PUBLIC_URL !== `https://${hostname}`
  )
    throw new Error(
      "Candidate runtime must match its isolated protected hostname.",
    );
  const accessAppId = await protectCandidate(hostname, manifest.workerName);
  await exposeAtprotoMetadata(hostname, manifest.workerName);
  const temp = mkdtempSync(join(tmpdir(), "atlas-web-release-"));
  try {
    const workerEnv = Object.fromEntries(
      PUBLIC_KEYS.filter((key) => runtime[key] !== undefined).map((key) => [
        key,
        { type: "text", value: runtime[key] },
      ]),
    );
    workerEnv.ATLAS_AUTH_MIGRATIONS = { type: "text", value: "external" };
    workerEnv.ATLAS_RELEASE_SHA = { type: "text", value: manifest.releaseSha };
    const secrets = Object.fromEntries(
      Object.entries(runtime).filter(
        ([key]) =>
          !PUBLIC_KEYS.includes(key) &&
          ![
            "DATABASE_URL",
            "ATLAS_AUTH_MIGRATIONS",
            "ATLAS_RELEASE_SHA",
          ].includes(key),
      ),
    );
    if (architecture === "workers") {
      workerEnv.HYPERDRIVE = {
        type: "hyperdrive",
        id: await ensureHyperdrive(target, runtime),
      };
    } else {
      const journalPath = join(directory, "private-journal.json");
      const journal = existsSync(journalPath)
        ? JSON.parse(readFileSync(journalPath, "utf8"))
        : {
            releaseSha: manifest.releaseSha,
            originSecret: randomBytes(32).toString("base64url"),
          };
      if (journal.releaseSha !== manifest.releaseSha || !journal.originSecret)
        throw new Error(
          "Candidate recovery journal does not match this release.",
        );
      writeFileSync(journalPath, JSON.stringify(journal), { mode: 0o600 });
      const originSecret = journal.originSecret;
      const project = required("GCP_PROJECT_ID");
      const region = required("GCP_REGION");
      const image = `${region}-docker.pkg.dev/${project}/atlas-images/atlas-web:${manifest.releaseSha}`;
      const accountArgs = process.env.ATLAS_GCP_ACCOUNT
        ? [`--account=${process.env.ATLAS_GCP_ACCOUNT}`]
        : [];
      const repository = JSON.parse(
        tool("gcloud", [
          "artifacts",
          "repositories",
          "describe",
          "atlas-images",
          `--project=${project}`,
          `--location=${region}`,
          "--format=json",
          ...accountArgs,
        ]),
      );
      const posture = evaluateRepositoryCostPosture(repository);
      if (posture.status !== "pass" || repository.cleanupPolicyDryRun === true)
        throw new Error(
          "Existing image repository must have active cleanup policies before candidate creation.",
        );
      cpSync(join(directory, "artifact"), join(temp, "image-context/.output"), {
        recursive: true,
      });
      cpSync(
        join(ROOT, "services/web-edge"),
        join(temp, "image-context/web-origin"),
        { recursive: true },
      );
      cpSync(
        join(ROOT, "services/web-edge/Dockerfile"),
        join(temp, "image-context/Dockerfile"),
      );
      tool("docker", [
        "build",
        "--platform=linux/amd64",
        "-t",
        image,
        join(temp, "image-context"),
      ]);
      const container = tool("docker", ["create", image]);
      try {
        tool("docker", [
          "cp",
          `${container}:/app/.output/.`,
          join(temp, "image-output"),
        ]);
        if (
          digestDirectory(join(temp, "image-output")) !==
          manifest.artifactDigest
        )
          throw new Error(
            "Container server differs from the prepared release.",
          );
        if (
          digestDirectory(join(temp, "image-output/public")) !==
          manifest.assetsDigest
        )
          throw new Error(
            "Container assets differ from the prepared release; do not mix separately built artifacts.",
          );
      } finally {
        tool("docker", ["rm", container]);
      }
      tool("docker", ["push", image]);
      const imageDigest = tool("docker", [
        "inspect",
        "--format",
        "{{index .RepoDigests 0}}",
        image,
      ]);
      const envFile = join(temp, "runtime.json");
      writeFileSync(
        envFile,
        JSON.stringify({
          ...runtime,
          ATLAS_AUTH_MIGRATIONS: "external",
          ATLAS_WEB_ORIGIN_SECRET: originSecret,
          ATLAS_RELEASE_SHA: manifest.releaseSha,
        }),
        { mode: 0o600 },
      );
      const service = `atlas-web-${target}`;
      // A retry gets a new immutable revision even if the previous attempt partially succeeded.
      const tag =
        "r-" +
        manifest.releaseSha.slice(0, 12) +
        "-" +
        randomBytes(4).toString("hex");
      const args = [
        "run",
        "deploy",
        service,
        `--project=${project}`,
        `--region=${region}`,
        `--image=${imageDigest}`,
        `--env-vars-file=${envFile}`,
        `--revision-suffix=${tag}`,
        `--tag=${tag}`,
        "--no-traffic",
        "--allow-unauthenticated",
        "--ingress=all",
        "--min-instances=0",
        "--max-instances=4",
        "--cpu=1",
        "--memory=768Mi",
        "--concurrency=8",
        "--timeout=180",
        "--port=3000",
        "--cpu-throttling",
        "--quiet",
        "--format=json",
      ];
      if (process.env.ATLAS_GCP_ACCOUNT)
        args.push(`--account=${process.env.ATLAS_GCP_ACCOUNT}`);
      const deployed = JSON.parse(tool("gcloud", args));
      if (evaluateCloudRunCostPosture(deployed).status !== "pass")
        throw new Error("Deployed service cost posture failed readback.");
      const revision = `${service}-${tag}`;
      const tagged = deployed.status?.traffic?.find(
        (item) => item.tag === tag && item.revisionName === revision,
      );
      if (!tagged?.url || deployed.status.latestReadyRevisionName !== revision)
        throw new Error("Pinned Cloud Run revision was not confirmed.");
      Object.assign(manifest, { originUrl: tagged.url, revision, imageDigest });
      workerEnv.ATLAS_WEB_ORIGIN_URL = { type: "text", value: tagged.url };
      for (const key of Object.keys(secrets)) delete secrets[key];
      secrets.ATLAS_WEB_ORIGIN_SECRET = originSecret;
    }
    verifyWebManifest(manifest, observed);
    for (const key of Object.keys(secrets)) workerEnv[key] = { type: "secret" };
    await prepareCloudflareOutput({
      directory,
      architecture,
      outputRoot: temp,
      accountId: required("CLOUDFLARE_ACCOUNT_ID"),
      workerName: manifest.workerName,
      workerEnv,
      hostname,
    });
    const secretFile = join(temp, "secrets.json");
    writeFileSync(secretFile, JSON.stringify(secrets), { mode: 0o600 });
    tool(
      process.execPath,
      [
        join(ROOT, "node_modules/cf/bin/cf"),
        "deploy",
        "--prebuilt",
        "--secrets-file",
        secretFile,
        "--tag",
        manifest.releaseSha,
        "--message",
        `Atlas ${manifest.architecture} candidate ${manifest.releaseSha}`,
        ...(architecture === "workers" ? ["--mode", "production"] : []),
        ...(!process.env.CLOUDFLARE_API_TOKEN
          ? ["--profile", required("ATLAS_CF_PROFILE")]
          : []),
      ],
      { cwd: temp },
    );
    // Read back the exact deployed version after cf applies its protected domain.
    const deployments = cloudflareCommand([
      "workers",
      "deployments",
      "list",
      "--worker",
      manifest.workerName,
    ]);
    const versions = deployments.deployments?.[0]?.versions;
    if (versions?.length !== 1 || versions[0].percentage !== 100)
      throw new Error("Worker deployment version readback failed.");
    assertCandidateDomain(
      cloudflareCommand(["workers", "get", manifest.workerName]),
      {
        workerName: manifest.workerName,
        hostname,
        zoneId: required("CLOUDFLARE_ZONE_ID"),
      },
    );
    const deployment = {
      ...manifest,
      workerVersionId: versions[0].version_id,
      candidateUrl: `https://${hostname}`,
      accessAppId,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(
      join(directory, "deployment.json"),
      JSON.stringify(deployment, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        {
          candidateUrl: deployment.candidateUrl,
          workerVersionId: deployment.workerVersionId,
          releaseSha: manifest.releaseSha,
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const value = (key) =>
    args.includes(key) ? args[args.indexOf(key) + 1] : null;
  const target = value("--target");
  const architecture = value("--architecture");
  if (!["staging", "production"].includes(target))
    throw new Error("Explicit --target staging|production is required.");
  if (args[0] === "bootstrap-access") return bootstrapAccess(target);
  if (
    args[0] === "prepare-runtime" &&
    ["workers", "hybrid"].includes(architecture) &&
    value("--output")
  )
    return prepareCandidateRuntime(
      target,
      architecture,
      resolve(value("--output")),
    );
  if (
    args[0] !== "publish" ||
    !["workers", "hybrid"].includes(architecture) ||
    !value("--directory")
  )
    throw new Error(
      "Use publish --target ... --architecture ... --directory ... or bootstrap-access --target ...",
    );
  await publish(resolve(value("--directory")), target, architecture);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
