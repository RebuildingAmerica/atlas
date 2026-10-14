import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertRuntimeDeployments, sameRuntimeRelease } from "./web-assess.mjs";
import { digestDirectory, verifyWebManifest } from "./web-release.mjs";
import { preserveRuntimeIdentity } from "./web-runtime-identity.mjs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const fail = () => {
  throw new Error(
    "The retained web candidate differs from live Cloudflare production.",
  );
};

/** Adopt the already-routed first release without making a provider change. */
export function adoptWebBaseline({
  source,
  destination,
  accountId,
  zoneId,
  canonicalUrl,
  runtime,
  cloudflare,
}) {
  const manifest = read(join(source, "manifest.json"));
  const deployment = read(join(source, "deployment.json"));
  verifyWebManifest(deployment, {
    releaseSha: manifest.releaseSha,
    artifactDigest: digestDirectory(join(source, "artifact")),
    assetsDigest: digestDirectory(join(source, "assets")),
  });
  for (const key of [
    "target",
    "architecture",
    "execution",
    "releaseSha",
    "workerName",
    "artifactDigest",
    "assetsDigest",
    "publicEnv",
    "buildPublicEnv",
    "runtimeDependencies",
    "releasePolicy",
  ])
    if (JSON.stringify(manifest[key]) !== JSON.stringify(deployment[key]))
      fail();
  const hostname = new URL(canonicalUrl).hostname;
  const candidate = new URL(deployment.candidateUrl);
  if (
    deployment.target !== "staging" ||
    deployment.architecture !== "workers" ||
    deployment.execution !== "cloudflare-durable" ||
    deployment.accountId !== accountId ||
    deployment.zoneId !== zoneId ||
    deployment.releaseSha !== manifest.releaseSha ||
    deployment.publicEnv.ATLAS_PUBLIC_URL !== deployment.candidateUrl ||
    deployment.publicEnv.ATLAS_WEB_CANONICAL_URL !== canonicalUrl ||
    deployment.buildPublicEnv.ATLAS_PUBLIC_URL !== canonicalUrl ||
    candidate.protocol !== "https:" ||
    candidate.hostname !== `${deployment.workerName}.${hostname}` ||
    candidate.pathname !== "/" ||
    candidate.search ||
    candidate.hash
  )
    fail();
  preserveRuntimeIdentity(
    runtime,
    deployment.releaseSha,
    deployment.runtimeIdentity,
  );

  const zone = cloudflare(["zones", "get", "--zone", zoneId]);
  const worker = cloudflare(["workers", "get", deployment.workerName]);
  const domains = worker.references?.domains;
  const staging = `atlas-staging.${zone.name}`;
  if (
    zone.id !== zoneId ||
    zone.account?.id !== accountId ||
    !hostname.endsWith(`.${zone.name}`) ||
    worker.name !== deployment.workerName ||
    !Array.isArray(domains) ||
    ![candidate.hostname, hostname].every((name) =>
      domains.some((row) => row.hostname === name && row.zone_id === zoneId),
    ) ||
    domains.some(
      (row) =>
        row.zone_id !== zoneId ||
        ![candidate.hostname, hostname, staging].includes(row.hostname),
    )
  )
    fail();
  const version = cloudflare([
    "workers",
    "versions",
    "get",
    deployment.workerVersionId,
    "--worker-id",
    deployment.workerName,
  ]);
  const bindings = version.env;
  if (
    version.id !== deployment.workerVersionId ||
    version.annotations?.["workers/tag"] !== deployment.releaseSha ||
    version.annotations?.["workers/message"] !==
      `Atlas workers candidate ${deployment.releaseSha}` ||
    !bindings ||
    Object.entries(deployment.publicEnv).some(
      ([name, value]) =>
        bindings[name]?.type !== "plain_text" || bindings[name]?.text !== value,
    ) ||
    bindings.ATLAS_RELEASE_SHA?.text !== deployment.releaseSha ||
    bindings.NODE_ENV?.text !== "production" ||
    bindings.ATLAS_AUTH_MIGRATIONS?.text !== "external" ||
    bindings.ATLAS_API_ROUTE_PREFIX?.text !== "" ||
    Object.keys(bindings).some(
      (name) =>
        bindings[name]?.type === "plain_text" &&
        !Object.hasOwn(deployment.publicEnv, name) &&
        ![
          "ATLAS_RELEASE_SHA",
          "NODE_ENV",
          "ATLAS_AUTH_MIGRATIONS",
          "ATLAS_API_ROUTE_PREFIX",
        ].includes(name),
    ) ||
    bindings.APP_RUNTIME?.namespace_id !== deployment.durableNamespaceId ||
    bindings.APP_RUNTIME?.class_name !== "AtlasAppRuntime" ||
    bindings.HYPERDRIVE?.id !== deployment.hyperdriveId ||
    bindings.API_RUNTIME?.script_name !==
      deployment.runtimeDependencies.api.workerName ||
    bindings.API_RUNTIME?.namespace_id !==
      deployment.runtimeDependencies.api.namespaceId ||
    bindings.API_RUNTIME?.class_name !== "ApiRuntime" ||
    bindings.ASSETS?.type !== "assets"
  )
    fail();
  assertRuntimeDeployments(
    {
      web: {
        ...deployment,
        namespaceId: deployment.durableNamespaceId,
        namespaceClass: "AtlasAppRuntime",
        storage: "sqlite",
      },
      api: deployment.runtimeDependencies.api,
      discovery: deployment.runtimeDependencies.discovery,
    },
    cloudflare,
  );
  for (const role of ["api", "discovery"]) {
    const identity = deployment.runtimeDependencies[role];
    const active = cloudflare([
      "workers",
      "versions",
      "get",
      identity.workerVersionId,
      "--worker-id",
      identity.workerName,
    ]);
    if (
      active.id !== identity.workerVersionId ||
      active.annotations?.["workers/tag"] !== identity.releaseSha ||
      !active.annotations?.["workers/message"]?.includes(
        `artifact=${identity.artifactDigest};`,
      ) ||
      active.env?.[role === "api" ? "API_RUNTIME" : "DISCOVERY_RUNTIME"]
        ?.namespace_id !== identity.namespaceId
    )
      fail();
  }
  for (const role of ["api", "discovery"])
    if (
      !sameRuntimeRelease(
        deployment.runtimeDependencies[role],
        manifest.runtimeDependencies[role],
      )
    )
      fail();

  mkdirSync(join(destination, ".."), { recursive: true });
  cpSync(source, destination, { recursive: true });
  const adopted = {
    ...deployment,
    adoptedBaseline: true,
    promotionState: "active",
    productionUrl: canonicalUrl,
    baselineDomains: domains.map((row) => row.hostname).sort(),
  };
  writeFileSync(
    join(destination, "deployment.json"),
    JSON.stringify(adopted, null, 2) + "\n",
    { mode: 0o600 },
  );
  return adopted;
}
