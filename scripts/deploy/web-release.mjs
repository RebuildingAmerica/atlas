import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import {
  assessWebRelease,
  runtimeReleaseIdentity,
  sameRuntimeRelease,
  validateReleasePolicy,
} from "./web-assess.mjs";

export const WEB_PUBLIC_ENV_KEYS = [
  "ATLAS_ADMIN_PUBLIC_URL",
  "NODE_ENV",
  "ATLAS_MANAGED",
  "ATLAS_MULTI_USER",
  "ATLAS_PUBLIC_URL",
  "ATLAS_WEB_CANONICAL_URL",
  "ATLAS_DOCS_URL",
  "ATLAS_AUTH_BASE_PATH",
  "ATLAS_SERVER_API_PROXY_TARGET",
  "ATLAS_AUTH_JWT_AUDIENCES",
];

/** Keep searchable URLs stable while the same bundles are tested on an isolated host. */
export function webBuildEnvironment(runtime) {
  return {
    ...runtime,
    ...(runtime.ATLAS_WEB_CANONICAL_URL
      ? { ATLAS_PUBLIC_URL: runtime.ATLAS_WEB_CANONICAL_URL }
      : {}),
  };
}

function publicEnvironment(env) {
  return Object.fromEntries(
    WEB_PUBLIC_ENV_KEYS.filter((key) => env?.[key] !== undefined).map((key) => [
      key,
      env[key],
    ]),
  );
}

export function digestDirectory(directory) {
  const hash = createHash("sha256");
  function walk(path) {
    for (const entry of readdirSync(path).sort()) {
      const file = join(path, entry);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink())
        throw new Error("Release artifacts must not contain symlinks.");
      if (stat.isDirectory()) walk(file);
      else {
        hash.update(relative(directory, file));
        hash.update("\0");
        hash.update(readFileSync(file));
        hash.update("\0");
      }
    }
  }
  walk(directory);
  return hash.digest("hex");
}

export function createWebManifest(input) {
  if (
    !["staging", "production"].includes(input.target) ||
    !["workers", "hybrid"].includes(input.architecture) ||
    !/^[a-f0-9]{40}$/.test(input.releaseSha)
  )
    throw new Error(
      "Explicit target, architecture and full commit SHA are required.",
    );
  if (
    input.execution !== undefined &&
    (input.execution !== "cloudflare-durable" ||
      input.architecture !== "workers")
  )
    throw new Error(
      "Only the explicit Cloudflare Durable Object execution mode is supported.",
    );
  return {
    schemaVersion: 1,
    target: input.target,
    architecture: input.architecture,
    releaseSha: input.releaseSha,
    workerName: `atlas-${input.architecture}-${input.target}-${input.releaseSha.slice(0, 12)}`,
    sourceDirty: input.sourceDirty,
    ...(input.execution
      ? {
          execution: input.execution,
          runtimeDependencies: {
            api: runtimeReleaseIdentity(input.runtimeDependencies?.api),
            discovery: runtimeReleaseIdentity(
              input.runtimeDependencies?.discovery,
            ),
          },
          ...(input.releasePolicy
            ? {
                releasePolicy: validateReleasePolicy(
                  input.releasePolicy,
                  input.releaseSha,
                ),
              }
            : {}),
        }
      : {}),
    artifactDigest: input.artifactDigest,
    assetsDigest: input.assetsDigest,
    authSchemaVersion: "atlas-web-2026-10-10",
    publicEnv: publicEnvironment(input.publicEnv),
    buildPublicEnv: publicEnvironment(
      webBuildEnvironment(input.publicEnv ?? {}),
    ),
    ...(input.architecture === "hybrid"
      ? {
          imageDigest: input.imageDigest,
          originUrl: input.originUrl,
          revision: input.revision,
        }
      : {}),
  };
}

export function verifyWebManifest(manifest, observed) {
  if (manifest.schemaVersion !== 1 || manifest.sourceDirty !== false)
    throw new Error("Release must be built from a clean committed checkout.");
  const canonical = createWebManifest(manifest);
  if (canonical.workerName !== manifest.workerName)
    throw new Error("Worker name does not match the immutable release.");
  if (
    WEB_PUBLIC_ENV_KEYS.some(
      (key) => manifest.buildPublicEnv?.[key] !== canonical.buildPublicEnv[key],
    )
  )
    throw new Error("Release build-time public configuration mismatch.");
  for (const key of ["releaseSha", "artifactDigest", "assetsDigest"]) {
    const pattern = key === "releaseSha" ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/;
    if (!pattern.test(manifest[key]) || manifest[key] !== observed[key])
      throw new Error(`Release ${key} readback mismatch.`);
  }
  if (manifest.architecture === "hybrid") {
    if (
      !/^[^\s]+@sha256:[a-f0-9]{64}$/.test(manifest.imageDigest ?? "") ||
      !manifest.revision
    )
      throw new Error(
        "Hybrid release requires an immutable image digest and revision.",
      );
    const origin = new URL(manifest.originUrl);
    if (
      origin.protocol !== "https:" ||
      !origin.hostname.endsWith(".run.app") ||
      !origin.hostname.includes("---") ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    )
      throw new Error(
        "Hybrid release requires a pinned Cloud Run revision-tag origin.",
      );
  }
  return true;
}

export function assertPromotionReady(evidence, manifest, now = Date.now()) {
  if (evidence.releaseSha !== manifest.releaseSha)
    throw new Error("Evidence must belong to this exact release.");
  const assessment = assessWebRelease(evidence, now);
  if (assessment.selected !== manifest.architecture)
    throw new Error(
      `This architecture has not passed the selection gates. ${assessment.blockers.join(" ")}`,
    );
  const end = Date.parse(evidence.baseline?.windowEnd ?? "");
  if (!Number.isFinite(end) || end > now || now - end > 48 * 3600_000)
    throw new Error("Baseline must end within the last 48 hours.");
  const policy = validateReleasePolicy(
    evidence.releasePolicy,
    manifest.releaseSha,
    now,
  );
  if (policy) {
    const web = evidence.durable.runtimeReleases.web;
    if (
      manifest.execution !== "cloudflare-durable" ||
      web.workerName !== manifest.workerName ||
      web.workerVersionId !== manifest.workerVersionId ||
      web.artifactDigest !== manifest.artifactDigest ||
      web.namespaceId !== manifest.durableNamespaceId ||
      web.namespaceClass !== "AtlasAppRuntime" ||
      !["api", "discovery"].every((key) =>
        sameRuntimeRelease(
          manifest.runtimeDependencies?.[key],
          evidence.durable.runtimeReleases[key],
        ),
      )
    )
      throw new Error(
        "Immediate evidence must pin the exact web/API/discovery deployment.",
      );
    const checked = Date.parse(evidence.staging?.lastCheckedAt ?? "");
    if (
      evidence.staging?.currentChecksPassed !== true ||
      evidence.staging?.windowWaived !== true ||
      !Number.isFinite(checked) ||
      checked > now ||
      now - checked > 600_000
    )
      throw new Error(
        "A current real protected staging probe is required even when the observation window is waived.",
      );
    return assessment;
  }
  if (manifest.execution)
    throw new Error(
      "Durable Object promotion requires an explicit release policy.",
    );
  const start = Date.parse(evidence.staging?.startedAt ?? "");
  const checked = Date.parse(evidence.staging?.lastCheckedAt ?? "");
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(checked) ||
    checked > now ||
    now - checked > 10 * 60_000 ||
    checked - start < 24 * 3600_000 ||
    evidence.staging?.continuousChecksPassed !== true
  )
    throw new Error(
      "24 hours of current successful staging observations are required.",
    );
  return assessment;
}

/** Materialize only links contained in this build, so Node tracing stays portable. */
export function copyWebArtifact(source, destination) {
  const root = realpathSync(source);
  const active = new Set();
  function copy(from, to) {
    const resolved = realpathSync(from);
    if (resolved !== root && !resolved.startsWith(root + sep))
      throw new Error("Build link escapes its artifact directory.");
    const stat = lstatSync(resolved);
    if (stat.isDirectory()) {
      if (active.has(resolved))
        throw new Error("Build artifact contains a directory cycle.");
      active.add(resolved);
      mkdirSync(to, { recursive: true });
      for (const name of readdirSync(resolved).sort())
        copy(join(resolved, name), join(to, name));
      active.delete(resolved);
    } else if (stat.isFile()) copyFileSync(resolved, to);
    else throw new Error("Unsupported build artifact entry.");
  }
  copy(root, destination);
}
