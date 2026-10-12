#!/usr/bin/env node
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeInventoryPasses } from "./billing-inventory.mjs";
import { setTimeout } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { cloudflareCommand } from "./cloudflare-cli.mjs";
import { createWebManifest } from "./web-release.mjs";
import {
  assertRuntimeDeployments,
  runtimeReleaseIdentity,
  validateReleasePolicy,
} from "./web-assess.mjs";

const PAGES = [
  "/",
  "/browse",
  "/map",
  "/profiles/people",
  "/profiles/organizations",
  "/sign-in",
];
const BASE_CHECKS = [
  "active-deployment",
  ...PAGES.map((path) => `page:${path}`),
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
];
const ROOT = resolve(import.meta.dirname, "../..");
const TEN_MINUTES = 600_000;

/** Preserve the existing protected verifier; do not deploy an untestable candidate. */
export function assertWebObserverConfiguration(
  runtime,
  { clientId, clientSecret, hostedSecret },
) {
  if (
    !clientId?.trim() ||
    !clientSecret?.trim() ||
    !hostedSecret?.trim() ||
    runtime.ATLAS_HOSTED_E2E_ENABLED !== "1" ||
    runtime.ATLAS_HOSTED_E2E_PRODUCTION_ENABLED !== "1" ||
    runtime.ATLAS_HOSTED_E2E_SECRET !== hostedSecret
  )
    throw new Error(
      "The existing protected hosted verifier and matching Access credentials are required before candidate provisioning.",
    );
}
function cleanOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("An explicit clean HTTPS origin is required.");
  return url.origin;
}
function validateIdentity(input) {
  const {
    origin,
    releaseSha,
    target,
    architecture,
    workerName,
    workerVersionId,
    artifactDigest,
    assetsDigest,
  } = input;
  cleanOrigin(origin);
  if (
    !/^[a-f0-9]{40}$/.test(releaseSha ?? "") ||
    !["staging", "production"].includes(target) ||
    !["workers", "hybrid"].includes(architecture)
  )
    throw new Error("Exact release SHA, target and architecture are required.");
  if (
    workerName !== createWebManifest(input).workerName ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      workerVersionId ?? "",
    ) ||
    !/^[a-f0-9]{64}$/.test(artifactDigest ?? "") ||
    !/^[a-f0-9]{64}$/.test(assetsDigest ?? "")
  )
    throw new Error(
      "Immutable Worker version and artifact identity are required.",
    );
  const identity = {
    origin,
    releaseSha,
    target,
    architecture,
    workerName,
    workerVersionId,
    artifactDigest,
    assetsDigest,
  };
  if (input.execution) {
    if (
      input.execution !== "cloudflare-durable" ||
      architecture !== "workers" ||
      !/^[a-f0-9]{32}$/.test(input.durableNamespaceId ?? "")
    )
      throw new Error(
        "Durable Object observation requires the exact web namespace.",
      );
    identity.execution = input.execution;
    identity.durableNamespaceId = input.durableNamespaceId;
    identity.runtimeDependencies = {
      api: runtimeReleaseIdentity(input.runtimeDependencies?.api),
      discovery: runtimeReleaseIdentity(input.runtimeDependencies?.discovery),
    };
  }
  if (architecture === "hybrid") {
    if (
      !/^atlas-web-(?:staging|production)-[a-z0-9-]+$/.test(
        input.revision ?? "",
      ) ||
      !/^[^\s]+@sha256:[a-f0-9]{64}$/.test(input.imageDigest ?? "")
    )
      throw new Error("Pinned hybrid revision and image digest are required.");
    Object.assign(identity, {
      revision: input.revision,
      imageDigest: input.imageDigest,
      originUrl: input.originUrl,
    });
  }
  return identity;
}

function inspectCloudRun(args) {
  const project = process.env.GCP_PROJECT_ID?.trim(),
    region = process.env.GCP_REGION?.trim();
  if (!project || !region)
    throw new Error("Explicit Google project and region are required.");
  const result = spawnSync(
    "gcloud",
    [
      ...args,
      `--project=${project}`,
      `--region=${region}`,
      "--format=json",
      ...(process.env.ATLAS_GCP_ACCOUNT
        ? [`--account=${process.env.ATLAS_GCP_ACCOUNT}`]
        : []),
    ],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0)
    throw new Error("Cloud Run deployment readback failed.");
  return JSON.parse(result.stdout);
}
function requiredChecks(protectedCandidate, architecture, execution) {
  return [
    ...BASE_CHECKS,
    ...(protectedCandidate ? ["access-denial"] : []),
    ...(architecture === "hybrid" ? ["origin-rejection"] : []),
    ...(execution ? ["joint-runtime"] : []),
  ];
}
async function boundedBody(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error("response_too_large");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}
function requireHtml(response, text, profile = false) {
  if (
    response.status !== 200 ||
    !response.headers.get("content-type")?.includes("text/html") ||
    !/<html[\s>]/i.test(text) ||
    !/<body[\s>]/i.test(text) ||
    /route-error-panel|Something went wrong/.test(text)
  )
    throw new Error("render_failed");
  if (profile && !/href=["']https:\/\//i.test(text))
    throw new Error("profile_sources_missing");
}

/** Real read-only probes; no body, identity, credentials or provider errors enter evidence. */
export async function probeWebRelease({
  origin,
  releaseSha,
  target,
  architecture,
  workerName,
  workerVersionId,
  artifactDigest,
  assetsDigest,
  execution,
  durableNamespaceId,
  runtimeDependencies,
  revision,
  imageDigest,
  canonicalOrigin = origin,
  originUrl,
  clientId,
  clientSecret,
  hostedSecret,
  fetcher = fetch,
  cloudflare = cloudflareCommand,
  google = inspectCloudRun,
  now = () => new Date(),
}) {
  const identity = validateIdentity({
    origin,
    releaseSha,
    target,
    architecture,
    workerName,
    workerVersionId,
    artifactDigest,
    assetsDigest,
    execution,
    durableNamespaceId,
    runtimeDependencies,
    revision,
    imageDigest,
    originUrl,
  });
  canonicalOrigin = cleanOrigin(canonicalOrigin);
  if (Boolean(clientId) !== Boolean(clientSecret) || !hostedSecret?.trim())
    throw new Error(
      "Paired Access credentials and the existing hosted verifier secret are required.",
    );
  if (architecture === "hybrid") {
    const url = new URL(originUrl);
    if (
      cleanOrigin(originUrl) !== url.origin ||
      !url.hostname.endsWith(".run.app") ||
      !url.hostname.includes("---")
    )
      throw new Error("A pinned Cloud Run revision origin is required.");
  }
  const checks = [];
  async function request(
    path,
    { method = "GET", inventory = false, anonymous = false } = {},
  ) {
    let url = new URL(path, origin);
    const headers = new Headers({
      accept: inventory ? "application/json" : "*/*",
    });
    if (!anonymous && clientId) {
      headers.set("cf-access-client-id", clientId);
      headers.set("cf-access-client-secret", clientSecret);
    }
    if (inventory) headers.set("x-atlas-hosted-e2e-secret", hostedSecret);
    const signal = AbortSignal.timeout(20_000);
    for (let redirect = 0; redirect <= 3; redirect++) {
      if (url.origin !== origin) throw new Error("external_redirect");
      const response = await fetcher(url.href, {
        method,
        headers,
        signal,
        redirect: "manual",
      });
      if (![301, 302, 303, 307, 308].includes(response.status) || anonymous)
        return { response, text: await boundedBody(response) };
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (inventory || !location || redirect === 3)
        throw new Error("unexpected_redirect");
      url = new URL(location, url);
    }
    throw new Error("unexpected_redirect");
  }
  async function check(name, action) {
    const started = performance.now();
    try {
      await action();
      checks.push({
        name,
        status: "pass",
        durationMs: Math.round(performance.now() - started),
      });
    } catch {
      checks.push({
        name,
        status: "fail",
        reason: "probe_failed",
        durationMs: Math.round(performance.now() - started),
      });
    }
  }
  await check("active-deployment", async () => {
    const current = cloudflare([
      "workers",
      "deployments",
      "list",
      "--worker",
      workerName,
    ]);
    const versions = current.deployments?.[0]?.versions;
    if (
      versions?.length !== 1 ||
      versions[0].percentage !== 100 ||
      versions[0].version_id !== workerVersionId
    )
      throw new Error("Worker version changed.");
    if (architecture === "hybrid") {
      const service = google([
        "run",
        "services",
        "describe",
        `atlas-web-${target}`,
      ]);
      if (
        !service.status?.traffic?.some(
          (row) => row.url === originUrl && row.revisionName === revision,
        )
      )
        throw new Error("Cloud Run revision tag changed.");
      const currentRevision = google([
        "run",
        "revisions",
        "describe",
        revision,
      ]);
      if (
        currentRevision.status?.imageDigest !== imageDigest ||
        !currentRevision.status?.conditions?.some(
          (row) => row.type === "Ready" && row.status === "True",
        )
      )
        throw new Error("Cloud Run image or readiness changed.");
    }
  });
  if (execution)
    await check("joint-runtime", async () =>
      assertRuntimeDeployments(
        {
          web: {
            workerName,
            releaseSha,
            workerVersionId,
            artifactDigest,
            namespaceId: durableNamespaceId,
            namespaceClass: "AtlasAppRuntime",
            storage: "sqlite",
          },
          ...identity.runtimeDependencies,
        },
        cloudflare,
      ),
    );
  for (const path of PAGES)
    await check(`page:${path}`, async () => {
      const { response, text } = await request(path);
      requireHtml(response, text);
    });
  await check("api-health", async () => {
    const { response, text } = await request("/api/health");
    if (response.status !== 200 || JSON.parse(text)?.status !== "ok")
      throw new Error("health_failed");
  });
  await check("anonymous-session", async () => {
    const { response, text } = await request("/api/auth/get-session");
    const value = JSON.parse(text);
    if (
      response.status !== 200 ||
      !/no-store/.test(response.headers.get("cache-control") ?? "") ||
      !(value === null || (value?.user === null && value?.session === null))
    )
      throw new Error("anonymous_identity_failed");
  });
  for (const [type, collection] of [
    ["person", "people"],
    ["organization", "organizations"],
  ]) {
    let slug;
    await check(`catalog:${type}`, async () => {
      const { response, text } = await request(
        `/api/entities?entity_type=${type}&limit=1`,
      );
      const data = JSON.parse(text);
      slug = data?.items?.[0]?.slug;
      if (
        response.status !== 200 ||
        typeof slug !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)
      ) {
        slug = undefined;
        throw new Error("catalog_failed");
      }
    });
    await check(`profile:${type}`, async () => {
      if (!slug) throw new Error("profile_missing");
      const { response, text } = await request(
        `/profiles/${collection}/${slug}`,
      );
      requireHtml(response, text, true);
    });
  }
  await check("documentation", async () => {
    const { response, text } = await request("/docs");
    requireHtml(response, text);
  });
  for (const path of ["/mcp", "/mcp/"])
    await check(`mcp:${path}`, async () => {
      const { response } = await request(path, { method: "POST" });
      const challenge = response.headers.get("www-authenticate") ?? "";
      if (
        response.status !== 401 ||
        !challenge.startsWith("Bearer ") ||
        !challenge.includes(
          `resource_metadata="${canonicalOrigin}/.well-known/oauth-protected-resource/mcp"`,
        )
      )
        throw new Error("mcp_challenge_failed");
    });
  await check("release-billing", async () => {
    const { response, text } = await request(
      "/api/e2e/hosted/billing-inventory",
      { method: "POST", inventory: true },
    );
    if (
      response.status !== 200 ||
      !runtimeInventoryPasses(JSON.parse(text), releaseSha)
    )
      throw new Error("release_billing_failed");
  });
  if (clientId)
    await check("access-denial", async () => {
      const { response } = await request("/api/health", { anonymous: true });
      const location = response.headers.get("location");
      if (response.status === 403) return;
      if (
        response.status !== 302 ||
        !location ||
        !new URL(location, origin).hostname.endsWith(".cloudflareaccess.com")
      )
        throw new Error("access_not_enforced");
    });
  if (architecture === "hybrid")
    await check("origin-rejection", async () => {
      const response = await fetcher(new URL("/api/health", originUrl).href, {
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      await response.body?.cancel();
      if (response.status !== 403) throw new Error("origin_not_protected");
    });
  return {
    schemaVersion: 1,
    ...identity,
    protectedCandidate: Boolean(clientId),
    collectedAt: now().toISOString(),
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    checks,
  };
}

/** Gaps, failures, changed releases and stale samples cannot stand in for 24 hours of operation. */
export function summarizeWebObservations(records, options) {
  const { now = Date.now(), minimumHours = 24 } = options;
  const identity = validateIdentity(options);
  const policy = validateReleasePolicy(
    options.releasePolicy,
    identity.releaseSha,
    now,
  );
  if (![24, 72].includes(minimumHours) && !(minimumHours === 0 && policy))
    throw new Error("Observation windows must be 24 or 72 hours.");
  let currentChecksPassed = false,
    startedAt = null,
    previous = null;
  const last = records.at(-1);
  for (const row of records) {
    const time = Date.parse(row.collectedAt);
    if (
      row.schemaVersion !== 1 ||
      Object.entries(identity).some(
        ([key, value]) => JSON.stringify(row[key]) !== JSON.stringify(value),
      ) ||
      typeof row.protectedCandidate !== "boolean" ||
      row.protectedCandidate !== last.protectedCandidate ||
      !Number.isFinite(time) ||
      time > now ||
      (previous !== null && time <= previous)
    )
      throw new Error("Observation identity or timestamp mismatch.");
    const names = requiredChecks(
      row.protectedCandidate,
      identity.architecture,
      identity.execution,
    );
    const passed =
      row.status === "pass" &&
      Array.isArray(row.checks) &&
      row.checks.length === names.length &&
      names.every(
        (name) =>
          row.checks.filter(
            (check) => check.name === name && check.status === "pass",
          ).length === 1,
      );
    currentChecksPassed = passed && now - time <= TEN_MINUTES;
    if (!passed) startedAt = null;
    else if (
      startedAt === null ||
      (previous !== null && time - previous > TEN_MINUTES)
    )
      startedAt = time;
    previous = time;
  }
  const continuousChecksPassed =
    minimumHours !== 0 &&
    startedAt !== null &&
    previous - startedAt >= minimumHours * 3_600_000 &&
    now - previous <= TEN_MINUTES;
  return {
    ...identity,
    minimumHours,
    startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
    lastCheckedAt: previous === null ? null : new Date(previous).toISOString(),
    continuousChecksPassed,
    currentChecksPassed,
    windowWaived: minimumHours === 0,
    ...(minimumHours === 0 ? { releasePolicy: policy } : {}),
    elapsedHours: startedAt === null ? 0 : (previous - startedAt) / 3_600_000,
    observations: records.length,
  };
}

export function webObservationSettings(deployment, env = process.env) {
  if (deployment.productionUrl) {
    if (
      deployment.target !== "production" ||
      deployment.promotionState !== "active" ||
      deployment.productionUrl !== deployment.publicEnv?.ATLAS_PUBLIC_URL
    )
      throw new Error("An active canonical production deployment is required.");
    return { origin: cleanOrigin(deployment.productionUrl) };
  }
  return {
    origin: deployment.candidateUrl,
    clientId: env.ATLAS_HOSTED_CF_ACCESS_CLIENT_ID,
    clientSecret: env.ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET,
  };
}

async function main(args) {
  const value = (key) =>
    args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const file = value("--deployment"),
    journal = value("--journal"),
    target = value("--target");
  if (!file || !journal)
    throw new Error(
      "--deployment and ignored --journal .atlas/... paths are required.",
    );
  const journalPath = resolve(ROOT, journal);
  if (!journalPath.startsWith(resolve(ROOT, ".atlas") + sep))
    throw new Error("Observation journals must remain under .atlas/.");
  const deployment = JSON.parse(readFileSync(file, "utf8"));
  const policyInput = value("--policy")
    ? JSON.parse(readFileSync(value("--policy"), "utf8"))
    : deployment.releasePolicy;
  const releasePolicy = validateReleasePolicy(
    policyInput?.releasePolicy ?? policyInput,
    deployment.releaseSha,
  );
  const minimumHours =
    value("--hours") === undefined
      ? releasePolicy
        ? 0
        : 24
      : Number(value("--hours"));
  if (
    (![24, 72].includes(minimumHours) &&
      !(minimumHours === 0 && releasePolicy)) ||
    (args.includes("--watch") && args.includes("--summary-only"))
  )
    throw new Error(
      "Use --hours 24|72, or 0 with the explicit operator policy; summary-only cannot watch.",
    );
  if (
    deployment.target !== target ||
    !deployment.workerVersionId ||
    !deployment.candidateUrl
  )
    throw new Error(
      "A published deployment for the explicit target is required.",
    );
  const identity = validateIdentity({
    ...deployment,
    ...webObservationSettings(deployment),
    target,
  });
  const records = existsSync(journalPath)
    ? readFileSync(journalPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  const summary = summarizeWebObservations(records, {
    ...identity,
    minimumHours,
    releasePolicy,
  });
  if (args.includes("--summary-only")) {
    console.log(JSON.stringify(summary, null, 2));
    if (
      !(summary.windowWaived
        ? summary.currentChecksPassed
        : summary.continuousChecksPassed)
    )
      process.exitCode = 1;
    return;
  }
  const audience =
    deployment.publicEnv?.ATLAS_AUTH_JWT_AUDIENCES?.split(",")[0];
  const report = await probeWebRelease({
    ...identity,
    originUrl: deployment.originUrl,
    canonicalOrigin: audience ? new URL(audience).origin : undefined,
    ...webObservationSettings(deployment),
    hostedSecret: process.env.ATLAS_HOSTED_E2E_SECRET,
  });
  mkdirSync(dirname(journalPath), { recursive: true, mode: 0o700 });
  appendFileSync(journalPath, JSON.stringify(report) + "\n", { mode: 0o600 });
  chmodSync(journalPath, 0o600);
  console.log(
    JSON.stringify(
      {
        probe: report,
        observationWindow: summarizeWebObservations([...records, report], {
          ...identity,
          minimumHours,
          releasePolicy,
        }),
      },
      null,
      2,
    ),
  );
  if (report.status !== "pass") process.exitCode = 1;
}
async function runCli() {
  const args = process.argv.slice(2);
  do {
    await main(args);
    if (!args.includes("--watch")) return;
    await setTimeout(5 * 60_000);
  } while (true);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  runCli().catch(() => {
    console.error(
      "Web observation failed; check explicit deployment identity, verifier credentials and the private journal. Provider details were suppressed.",
    );
    process.exitCode = 1;
  });
