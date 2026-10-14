import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptWebBaseline } from "./web-baseline.mjs";
import { createWebManifest, digestDirectory } from "./web-release.mjs";
import { preserveRuntimeIdentity } from "./web-runtime-identity.mjs";
import { retainedCloudflareRelease, recoveryDomains } from "./web-promote.mjs";

const sha = "a".repeat(40);
const accountId = "b".repeat(32);
const zoneId = "c".repeat(32);
const canonicalUrl = "https://atlas.example.com";
const candidateUrl = `https://atlas-workers-staging-${sha.slice(0, 12)}.atlas.example.com`;
const version = "12345678-1234-1234-1234-123456789abc";
const apiVersion = "22345678-1234-1234-1234-123456789abc";
const discoveryVersion = "32345678-1234-1234-1234-123456789abc";
const webNamespace = "d".repeat(32);
const apiNamespace = "e".repeat(32);
const discoveryNamespace = "f".repeat(32);
const runtime = {
  ATLAS_PUBLIC_URL: canonicalUrl,
  ATLAS_WEB_CANONICAL_URL: canonicalUrl,
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "atlas-baseline-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "candidate"),
    destination = join(root, "production");
  mkdirSync(join(source, "artifact"), { recursive: true });
  mkdirSync(join(source, "assets"));
  writeFileSync(join(source, "artifact", "server.js"), "server");
  writeFileSync(join(source, "assets", "main.js"), "client");
  const identity = (
    workerName,
    workerVersionId,
    namespaceId,
    namespaceClass,
  ) => ({
    workerName,
    workerVersionId,
    namespaceId,
    namespaceClass,
    releaseSha: sha,
    artifactDigest: "1".repeat(64),
    storage: "sqlite",
  });
  const api = identity(
    "atlas-api-production",
    apiVersion,
    apiNamespace,
    "ApiRuntime",
  );
  const discovery = identity(
    "atlas-discovery-production",
    discoveryVersion,
    discoveryNamespace,
    "DiscoveryRuntime",
  );
  const manifest = createWebManifest({
    target: "staging",
    architecture: "workers",
    execution: "cloudflare-durable",
    releaseSha: sha,
    sourceDirty: false,
    artifactDigest: digestDirectory(join(source, "artifact")),
    assetsDigest: digestDirectory(join(source, "assets")),
    runtimeDependencies: { api, discovery },
    publicEnv: {
      ATLAS_PUBLIC_URL: candidateUrl,
      ATLAS_WEB_CANONICAL_URL: canonicalUrl,
      ATLAS_SERVER_API_PROXY_TARGET: "https://atlas-api.example.com",
    },
  });
  const deployment = {
    ...manifest,
    workerVersionId: version,
    durableNamespaceId: webNamespace,
    accountId,
    zoneId,
    hyperdriveId: "2".repeat(32),
    candidateUrl,
    runtimeIdentity: preserveRuntimeIdentity(runtime, sha),
  };
  writeFileSync(join(source, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(source, "deployment.json"), JSON.stringify(deployment));
  const domains = [
    new URL(candidateUrl).hostname,
    "atlas-staging.example.com",
    "atlas.example.com",
  ].map((hostname) => ({ hostname, zone_id: zoneId }));
  const env = Object.fromEntries(
    Object.entries(manifest.publicEnv).map(([key, text]) => [
      key,
      { type: "plain_text", text },
    ]),
  );
  Object.assign(env, {
    ATLAS_RELEASE_SHA: { text: sha },
    NODE_ENV: { type: "plain_text", text: "production" },
    ATLAS_AUTH_MIGRATIONS: { type: "plain_text", text: "external" },
    ATLAS_API_ROUTE_PREFIX: { type: "plain_text", text: "" },
    APP_RUNTIME: { namespace_id: webNamespace, class_name: "AtlasAppRuntime" },
    API_RUNTIME: {
      namespace_id: apiNamespace,
      script_name: api.workerName,
      class_name: "ApiRuntime",
    },
    HYPERDRIVE: { id: deployment.hyperdriveId },
    ASSETS: { type: "assets" },
  });
  const names = [deployment.workerName, api.workerName, discovery.workerName];
  const versions = [version, apiVersion, discoveryVersion];
  const namespaces = [webNamespace, apiNamespace, discoveryNamespace];
  const classes = ["AtlasAppRuntime", "ApiRuntime", "DiscoveryRuntime"];
  const calls = [];
  function cf(args) {
    calls.push(args);
    if (args[0] === "zones")
      return { id: zoneId, account: { id: accountId }, name: "example.com" };
    if (args[1] === "get" && args[0] === "workers")
      return { name: deployment.workerName, references: { domains } };
    if (args[1] === "versions") {
      if (args[3] === version)
        return {
          id: version,
          annotations: {
            "workers/tag": sha,
            "workers/message": `Atlas workers candidate ${sha}`,
          },
          env,
        };
      const role = args[3] === apiVersion ? "api" : "discovery";
      return {
        id: args[3],
        annotations: {
          "workers/tag": sha,
          "workers/message": `Atlas production ${role}; artifact=${"1".repeat(64)}; schema=${"2".repeat(64)}; consumers paused`,
        },
        env: {
          [role === "api" ? "API_RUNTIME" : "DISCOVERY_RUNTIME"]: {
            namespace_id: role === "api" ? apiNamespace : discoveryNamespace,
          },
        },
      };
    }
    if (args[1] === "deployments") {
      const index = names.indexOf(args[4]);
      return {
        deployments: [
          { versions: [{ percentage: 100, version_id: versions[index] }] },
        ],
      };
    }
    if (args[0] === "durable-objects")
      return names.map((script, index) => ({
        id: namespaces[index],
        script,
        class: classes[index],
        use_sqlite: true,
      }));
    throw Error(`unexpected provider read ${args.join(" ")}`);
  }
  return {
    source,
    destination,
    manifest,
    deployment,
    domains,
    env,
    cf,
    calls,
    api,
  };
}

function adopt(f) {
  return adoptWebBaseline({
    source: f.source,
    destination: f.destination,
    accountId,
    zoneId,
    canonicalUrl,
    runtime,
    cloudflare: f.cf,
  });
}

test("adopts the exact live release twice without provider writes and retains a rollback source", (t) => {
  const f = fixture(t);
  const first = adopt(f);
  assert.equal(first.promotionState, "active");
  assert.equal(first.adoptedBaseline, true);
  assert.deepEqual(
    first.baselineDomains,
    f.domains.map((row) => row.hostname).sort(),
  );
  const second = adopt(f);
  assert.deepEqual(second, first);
  assert.ok(
    f.calls.every(
      (args) =>
        !args.some((part) =>
          ["create", "deploy", "upload", "delete"].includes(part),
        ),
    ),
  );
  assert.equal(
    readFileSync(join(f.destination, "artifact", "server.js"), "utf8"),
    "server",
  );
  assert.equal(
    retainedCloudflareRelease(
      f.destination,
      runtime,
      { accountId, zoneId, hostname: "atlas.example.com" },
      "new-production-worker",
    ).workerVersionId,
    version,
  );
  assert.deepEqual(
    recoveryDomains(first, { zoneId, hostname: "atlas.example.com" }, f.cf),
    f.domains.map((row) => row.hostname),
  );
});

test("mismatched artifact, route, version, configuration, or dependency cannot create a baseline", (t) => {
  for (const kind of [
    "artifact",
    "route",
    "version",
    "binding",
    "dependency",
    "account",
  ]) {
    const f = fixture(t);
    if (kind === "artifact")
      writeFileSync(join(f.source, "artifact", "server.js"), "changed");
    if (kind === "route") f.domains.splice(2, 1);
    if (kind === "version")
      f.deployment.workerVersionId = "42345678-1234-1234-1234-123456789abc";
    if (kind === "binding")
      f.env.ATLAS_PUBLIC_URL.text = "https://wrong.example.com";
    if (kind === "dependency") f.env.API_RUNTIME.namespace_id = "0".repeat(32);
    if (kind === "account") f.deployment.accountId = "0".repeat(32);
    if (["version", "account"].includes(kind))
      writeFileSync(
        join(f.source, "deployment.json"),
        JSON.stringify(f.deployment),
      );
    assert.throws(() => adopt(f), kind);
    assert.equal(existsSync(f.destination), false, kind);
    assert.ok(
      f.calls.every(
        (args) =>
          !args.some((part) =>
            ["create", "deploy", "upload", "delete"].includes(part),
          ),
      ),
      kind,
    );
  }
});
