#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cloudflareCommand as cf } from "./cloudflare-cli.mjs";
import {
  preparePythonOutput,
  preparePythonEdgeOutput,
} from "./api-cloudflare-output.mjs";
import {
  assertAccessPolicy,
  assertCandidateDomain,
  loadWebRuntime,
} from "./web-candidate.mjs";
import {
  assertEvaluationVersion,
  validateEvaluationDatabase,
} from "./web-durable-evaluation.mjs";
import { digestDirectory } from "./web-release.mjs";
import { apiSettingsFromService } from "./api-cloudflare-settings.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const required = (flag) => {
  const value = args[args.indexOf(flag) + 1];
  if (!args.includes(flag) || !value || value.startsWith("--"))
    throw Error(`${flag} is required.`);
  return value;
};
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!/^[a-f0-9]{32}$/.test(accountId ?? ""))
  throw Error("Explicit Cloudflare account required.");
if (
  execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim()
)
  throw Error("Commit the evaluation source before hosted deployment.");
const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: ROOT,
  encoding: "utf8",
}).trim();
const runtime = loadWebRuntime(
  readFileSync(required("--runtime-file"), "utf8"),
);
const access = readJson(required("--access-file"));
const hyperdriveId = required("--hyperdrive-id");
const edge = args.includes("--edge");
const discovery = args.includes("--discovery");
const apiSettings = args.includes("--api-settings-file")
  ? apiSettingsFromService(readJson(required("--api-settings-file")), runtime)
  : undefined;
if (apiSettings && (edge || discovery))
  throw Error("Production API settings belong only to the API evaluation.");
const workerName = edge
  ? "atlas-python-eval-edge"
  : discovery
    ? "atlas-python-eval-discovery"
    : "atlas-python-eval-api";
const pythonVersionId = edge
  ? assertEvaluationVersion(
      cf([
        "workers",
        "deployments",
        "list",
        "--worker",
        "atlas-python-eval-api",
      ]),
    )
  : undefined;
const discoveryVersionId =
  edge && discovery
    ? assertEvaluationVersion(
        cf([
          "workers",
          "deployments",
          "list",
          "--worker",
          "atlas-python-eval-discovery",
        ]),
      )
    : undefined;
const hostname =
  workerName +
  "." +
  new URL(runtime.ATLAS_WEB_CANONICAL_URL ?? runtime.ATLAS_PUBLIC_URL).hostname;
validateEvaluationDatabase(
  cf(["hyperdrive", "get", hyperdriveId]),
  runtime.DATABASE_URL,
);
const subscriptions = cf(["accounts", "subscriptions", "get"]);
if (
  !Array.isArray(subscriptions) ||
  subscriptions.some(
    (s) =>
      /workers/i.test(s.rate_plan?.id ?? "") && !/free/i.test(s.rate_plan.id),
  )
)
  throw Error("Workers Free required.");
if (!access.id || !access.client_id || !access.client_secret)
  throw Error("Existing Access service credentials required.");
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
          name: "Atlas Python runtime verification",
          decision: "non_identity",
          include: [{ service_token: { token_id: access.id } }],
        },
      ],
    },
  });
const policy = cf([
  "zero-trust",
  "access",
  "applications",
  "get",
  application.id,
]);
assertAccessPolicy(policy, policy.policies, hostname, access.id);
const destination = join(
  ROOT,
  ".atlas/python-evaluation",
  releaseSha,
  ...(edge ? ["edge"] : discovery ? ["discovery"] : []),
);
mkdirSync(destination, { recursive: true });
if (edge)
  await preparePythonEdgeOutput({
    destination,
    accountId,
    pythonWorkerName: "atlas-python-eval-api",
    ...(discovery
      ? { discoveryWorkerName: "atlas-python-eval-discovery" }
      : {}),
  });
else
  await preparePythonOutput({
    source: join(ROOT, "services/api-cloudflare/compatibility"),
    vendor: resolve(required("--vendor")),
    destination,
    workerName,
    accountId,
    durableExport: "ApiRuntime",
    entrypoint: discovery ? "discovery_entry.py" : "entry.py",
    packagesAsset: args.includes("--packages-asset"),
    workerEnv: {
      ...(apiSettings ? { ATLAS_API_SETTINGS: { type: "secret" } } : {}),
      HYPERDRIVE: { type: "hyperdrive", id: hyperdriveId },
      API_RUNTIME: {
        type: "durable-object",
        worker: workerName,
        exportName: "ApiRuntime",
      },
    },
  });
// Access is read back before a route can be attached.
const configFile = join(
  destination,
  ".cloudflare/output/v0/workers/default/worker.config.json",
);
const config = readJson(configFile);
config.domains = [hostname];
writeFileSync(configFile, JSON.stringify(config));
const artifactDigest = digestDirectory(
  join(destination, ".cloudflare/output/v0"),
);
const secretsFile = join(destination, "secrets-private.json");
if (apiSettings)
  writeFileSync(
    secretsFile,
    JSON.stringify({ ATLAS_API_SETTINGS: JSON.stringify(apiSettings) }),
    { mode: 0o600 },
  );
const deployed = spawnSync(
  process.execPath,
  [
    join(ROOT, "node_modules/cf/bin/cf"),
    "deploy",
    "--prebuilt",
    "--no-provision",
    ...(apiSettings ? ["--secrets-file", secretsFile] : []),
    "--profile",
    process.env.ATLAS_CF_PROFILE ?? "atlas",
    "--mode",
    "production",
    "--tag",
    releaseSha,
    "--message",
    "Read-only Python compatibility evaluation; not production",
  ],
  {
    cwd: destination,
    env: process.env,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 16 * 1024 * 1024,
  },
);
writeFileSync(
  join(destination, "deploy-private.log"),
  (deployed.stdout ?? "") + "\n" + (deployed.stderr ?? ""),
  { mode: 0o600 },
);
if (deployed.error || deployed.status !== 0)
  throw Error("cf deployment failed; details retained privately.");
const versionId = assertEvaluationVersion(
  cf(["workers", "deployments", "list", "--worker", workerName]),
);
const zoneId = required("--zone-id");
assertCandidateDomain(cf(["workers", "get", workerName]), {
  workerName,
  hostname,
  zoneId,
});
const report = {
  kind: "python-compatibility",
  productionEligible: false,
  releaseSha,
  artifactDigest,
  workerName,
  hostname,
  versionId,
  ...(edge ? { pythonVersionId } : {}),
  ...(discoveryVersionId ? { discoveryVersionId } : {}),
  accessAppId: application.id,
  deployedAt: new Date().toISOString(),
  checks: [],
};
const reportFile = join(destination, "report.json");
writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
const headers = {
  "CF-Access-Client-Id": access.client_id,
  "CF-Access-Client-Secret": access.client_secret,
};
for (const path of [
  "/health",
  ...(discovery && !edge ? [] : ["/database"]),
  ...(args.includes("--native")
    ? [edge && discovery ? "/discovery/native" : "/native"]
    : []),
]) {
  const response = await fetch("https://" + hostname + path, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  writeFileSync(
    join(destination, path.slice(1).replaceAll("/", "-") + "-private.txt"),
    body,
    {
      mode: 0o600,
    },
  );
  if (
    response.status !== 200 ||
    response.headers.get("cache-control") !== "private, no-store"
  )
    throw Error(
      "Hosted Python check failed for " +
        path +
        "; details retained privately.",
    );
  const result = JSON.parse(body);
  if (
    path.endsWith("/native") &&
    (result.deflate64_decoded !== true ||
      result.decoded_bytes !== 4017 ||
      result.name_types?.["Sarah Stone"] !== "Person" ||
      result.name_types?.["BANK OF AMERICA N A"] !== "Corporation" ||
      result.name_types?.["Sarah Stone until fall 2024"] !== "Corporation")
  )
    throw Error("Native discovery compatibility failed.");
  if (
    path === "/database" &&
    (result.query !== 1 ||
      result.timezone_offset_seconds !== 0 ||
      result.timestamp !== "2000-01-01T00:00:00+00:00" ||
      result.connection_closed !== true)
  )
    throw Error("PostgreSQL runtime contract failed.");
  report.checks.push({ path, status: response.status, result });
  writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
}
const denied = await fetch("https://" + hostname + "/health", {
  redirect: "manual",
  signal: AbortSignal.timeout(30000),
});
await denied.body?.cancel();
if (denied.status !== 403)
  throw Error("Anonymous Python origin request was not rejected.");
report.checks.push({ path: "/health", anonymous: true, status: denied.status });
writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report));
