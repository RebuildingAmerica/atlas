#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  existsSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assessWebRelease,
  runtimeReleaseIdentity,
  validateReleasePolicy,
} from "./web-assess.mjs";
import {
  createWebManifest,
  digestDirectory,
  copyWebArtifact,
  webBuildEnvironment,
  WEB_PUBLIC_ENV_KEYS,
} from "./web-release.mjs";

import { cloudflareCommand } from "./cloudflare-cli.mjs";
import {
  inspectGoogleBilling,
  bootstrapGoogleBilling,
} from "./web-google-cloud.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${binary} failed; inspect its redacted diagnostic output.`,
    );
  return result.stdout?.trim() ?? "";
}
function argument(args, key) {
  const value = args[args.indexOf(key) + 1];
  return args.includes(key) && value && !value.startsWith("--") ? value : null;
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/** Read-only provider inventory. Never changes the operator's active account/project. */
export async function doctor({
  target,
  fetcher = fetch,
  tool = run,
  cloudflare = cloudflareCommand,
}) {
  const checks = [];
  async function check(name, operation) {
    try {
      const details = await operation();
      checks.push({ name, status: "pass", details });
    } catch (error) {
      checks.push({ name, status: "block", reason: error.message });
    }
  }
  await check("cloudflare", async () => {
    const account = required("CLOUDFLARE_ACCOUNT_ID");
    const subscriptions = cloudflare(["accounts", "subscriptions", "get"]);
    if (!Array.isArray(subscriptions))
      throw new Error("Cloudflare subscription inventory is unavailable.");
    const workers = subscriptions.filter((item) =>
      /workers/i.test(item.rate_plan?.id ?? ""),
    );
    if (workers.some((item) => !/free/i.test(item.rate_plan.id)))
      throw new Error("The selected account has a paid Workers subscription.");
    return { accountId: account, workersPlan: "free" };
  });
  await check("google-cloud", async () => {
    if (
      process.env.ATLAS_WEB_EVIDENCE_FILE &&
      JSON.parse(readFileSync(process.env.ATLAS_WEB_EVIDENCE_FILE, "utf8"))
        .releasePolicy
    ) {
      const evidence = JSON.parse(
        readFileSync(process.env.ATLAS_WEB_EVIDENCE_FILE, "utf8"),
      );
      validateReleasePolicy(evidence.releasePolicy, evidence.releaseSha);
      return {
        required: false,
        reason: "The explicit Cloudflare-only policy excludes Google hosting.",
      };
    }
    const billing = inspectGoogleBilling({
      project: required("GCP_PROJECT_ID"),
      account: process.env.ATLAS_GCP_ACCOUNT,
      tool,
    });
    const args = [
      "run",
      "services",
      "list",
      `--project=${required("GCP_PROJECT_ID")}`,
      `--region=${required("GCP_REGION")}`,
      "--format=value(metadata.name)",
    ];
    if (process.env.ATLAS_GCP_ACCOUNT)
      args.push(`--account=${process.env.ATLAS_GCP_ACCOUNT}`);
    return {
      ...billing,
      services: tool("gcloud", args).split("\n").filter(Boolean),
    };
  });
  await check("vercel-inventory", async () => {
    required("VERCEL_ORG_ID");
    required("VERCEL_TOKEN");
    // Token stays in the HTTP header, never in process arguments or logs.
    const response = await fetcher(
      `https://api.vercel.com/v9/projects?teamId=${encodeURIComponent(process.env.VERCEL_ORG_ID)}`,
      { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } },
    );
    if (!response.ok)
      throw new Error(
        `Vercel project inventory returned HTTP ${response.status}.`,
      );
    const data = await response.json();
    if (!Array.isArray(data.projects))
      throw new Error("Vercel project inventory is unavailable.");
    return {
      projects: data.projects.map((project) => project.name),
      hasMore: Boolean(data.pagination?.next),
    };
  });
  await check("measured-evidence", async () => {
    const file = required("ATLAS_WEB_EVIDENCE_FILE");
    const assessment = assessWebRelease(JSON.parse(readFileSync(file, "utf8")));
    if (!assessment.selected) throw new Error(assessment.blockers.join(" "));
    return assessment;
  });
  return {
    target,
    status: checks.every((check) => check.status === "pass") ? "pass" : "block",
    checks,
  };
}

/** Build candidates locally; provider provisioning and cutover remain separately gated. */
export function webReleaseBuildSettings({
  architecture,
  releaseSha,
  evidence = {},
  env = process.env,
}) {
  const releasePolicy = validateReleasePolicy(
    evidence.releasePolicy,
    releaseSha,
  );
  if (releasePolicy) {
    if (architecture !== "workers")
      throw new Error("Approved Durable Object releases are Cloudflare-only.");
    return {
      execution: "cloudflare-durable",
      buildExecution: "durable-production",
      releasePolicy,
      runtimeDependencies: {
        api: runtimeReleaseIdentity(evidence.durable?.runtimeReleases?.api),
        discovery: runtimeReleaseIdentity(
          evidence.durable?.runtimeReleases?.discovery,
        ),
      },
    };
  }
  if (env.ATLAS_WORKERS_EXECUTION && env.ATLAS_WORKERS_EXECUTION !== "direct")
    throw new Error(
      "Experimental execution cannot produce a promotable release without an explicit policy.",
    );
  if (architecture === "hybrid")
    throw new Error(
      "Cloud Run is historical and is not an authorized fallback.",
    );
  return { buildExecution: "direct" };
}

function prepare(args, target) {
  const architecture = argument(args, "--architecture");
  if (!["workers", "hybrid"].includes(architecture))
    throw new Error("--architecture workers|hybrid is required.");
  const releaseSha = run("git", ["rev-parse", "HEAD"]);
  const settings = webReleaseBuildSettings({
    architecture,
    releaseSha,
    evidence: process.env.ATLAS_WEB_EVIDENCE_FILE
      ? JSON.parse(readFileSync(process.env.ATLAS_WEB_EVIDENCE_FILE, "utf8"))
      : {},
  });
  const sourceDirty = Boolean(run("git", ["status", "--porcelain"]));
  const directory = join(
    ROOT,
    ".atlas/web",
    target,
    releaseSha,
    settings.execution ?? architecture,
  );
  mkdirSync(directory, { recursive: true });
  run(
    "pnpm",
    [
      "--filter",
      "@rebuildingamerica/atlas-app",
      "run",
      architecture === "workers" ? "build:workers" : "build",
    ],
    {
      env: {
        ...webBuildEnvironment(process.env),
        ATLAS_WEB_RUNTIME: architecture === "workers" ? "workers" : "node",
        NITRO_PRESET: "node-server",
        ATLAS_RELEASE_SHA: releaseSha,
        ATLAS_WORKERS_EXECUTION: settings.buildExecution,
      },
      stdio: "inherit",
    },
  );
  const source = join(
    ROOT,
    "app",
    architecture === "workers" ? ".cloudflare/output/v0" : ".output",
  );
  rmSync(join(directory, "artifact"), { recursive: true, force: true });
  rmSync(join(directory, "assets"), { recursive: true, force: true });
  copyWebArtifact(source, join(directory, "artifact"));
  const assets =
    architecture === "workers"
      ? join(source, "workers/default/assets")
      : join(source, "public");
  cpSync(assets, join(directory, "assets"), { recursive: true });
  if (architecture === "hybrid") {
    run(
      "pnpm",
      ["--filter", "@rebuildingamerica/atlas-web-edge", "exec", "cf", "build"],
      { stdio: "inherit" },
    );
    copyWebArtifact(
      join(ROOT, "services/web-edge/.cloudflare/output/v0"),
      join(directory, "artifact/cf-edge"),
    );
  }
  const publicEnv = Object.fromEntries(
    WEB_PUBLIC_ENV_KEYS.filter((key) => process.env[key] !== undefined).map(
      (key) => [key, process.env[key]],
    ),
  );
  const manifest = createWebManifest({
    target,
    architecture,
    releaseSha,
    sourceDirty,
    publicEnv,
    artifactDigest: digestDirectory(join(directory, "artifact")),
    assetsDigest: digestDirectory(join(directory, "assets")),
    ...settings,
  });
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        directory,
        manifest,
        deployable: !sourceDirty,
        notice:
          "Local build only. No provider, promotion or cost gate has been satisfied.",
      },
      null,
      2,
    ),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const target = argument(args, "--target");
  if (!["staging", "production"].includes(target))
    throw new Error("--target staging|production is required.");
  if (command === "doctor") {
    const result = await doctor({ target });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "pass") process.exitCode = 1;
  } else if (command === "bootstrap-google-billing") {
    console.log(
      JSON.stringify(
        bootstrapGoogleBilling({
          project: required("GCP_PROJECT_ID"),
          account: required("ATLAS_GCP_ACCOUNT"),
          tool: run,
        }),
        null,
        2,
      ),
    );
  } else if (command === "prepare") prepare(args, target);
  else if (command === "assess") {
    const file = argument(args, "--evidence");
    if (!file || !existsSync(file))
      throw new Error("--evidence JSON file is required.");
    const result = assessWebRelease(JSON.parse(readFileSync(file, "utf8")));
    console.log(JSON.stringify(result, null, 2));
    if (!result.selected) process.exitCode = 1;
  } else
    throw new Error(
      "Use doctor, prepare, assess, or bootstrap-google-billing.",
    );
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
