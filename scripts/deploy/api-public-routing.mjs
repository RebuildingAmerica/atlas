#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBuildOutput } from "@cloudflare/build-output-utils";
import { cloudflareCommand } from "./cloudflare-cli.mjs";
import { assertRuntimeDeployments } from "./web-assess.mjs";
import { assertAccessPolicy } from "./web-candidate.mjs";
import { canonicalDigest } from "./canonical-digest.mjs";
import {
  matchesHost,
  routingIdentity,
  assertRoutingContinuity,
} from "./api-routing-receipt.mjs";
export { assertCurrentApiRoutingReceipt } from "./api-routing-receipt.mjs";
import { digestDirectory } from "./web-release.mjs";

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const ID = /^[a-f0-9]{32}$/;
const VERSION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sorted = (rows) =>
  rows
    .map(({ id, pattern, script }) => ({
      id,
      pattern,
      ...(script === undefined ? {} : { script }),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

/** The route API needs no DNS mutation or local credential-store discovery.
 * https://developers.cloudflare.com/api/resources/workers/subresources/routes/ */
export function routeClient(zoneId, env, fetcher = fetch) {
  if (!ID.test(zoneId ?? "") || !env.CLOUDFLARE_API_TOKEN?.trim())
    throw Error("Explicit route zone and existing CI token required.");
  const request = async (method, suffix = "", body) => {
    try {
      const response = await fetcher(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes${suffix}`,
        {
          method,
          headers: {
            authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            "content-type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      );
      const result = await response.json();
      if (!response.ok || result.success !== true)
        throw Error("Provider request failed.");
      return result;
    } catch {
      throw Error(
        "Worker route request failed; private provider diagnostics suppressed.",
      );
    }
  };
  return {
    async list() {
      const body = await request("GET");
      if (
        !Array.isArray(body.result) ||
        body.result_info?.total_pages > 1 ||
        body.result_info?.total_count > body.result.length ||
        body.result.some(
          (row) =>
            !ID.test(row.id ?? "") ||
            typeof row.pattern !== "string" ||
            (row.script !== undefined && typeof row.script !== "string"),
        )
      )
        throw Error("Complete Worker route inventory required.");
      return sorted(body.result);
    },
    async create(body) {
      return (await request("POST", "", body)).result;
    },
    async delete(id) {
      if (!ID.test(id ?? ""))
        throw Error("Exact retained Worker route ID required.");
      return (await request("DELETE", `/${id}`)).result;
    },
  };
}

/** Prove directory availability, private-route isolation and MCP authorization. */
export async function probePublicApi({
  origin,
  prefix = "",
  headers = {},
  fetcher = fetch,
}) {
  let entry;
  for (const [path, status] of [
    ["/health", 200],
    ["/api/entities?limit=1", 200],
    ["/__atlas/release", 404],
    ["/api/platform/waitlist", 404],
  ]) {
    const response = await fetcher(`${origin}${prefix}${path}`, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    try {
      if (response.status !== status)
        throw Error("Public API health, directory or privacy proof failed.");
      if (path === "/health" && (await response.json()).status !== "ok")
        throw Error("Public API health body failed.");
      if (path.startsWith("/api/entities")) {
        entry = (await response.json()).items?.[0];
        if (
          !entry ||
          !["person", "organization"].includes(entry.type) ||
          typeof entry.id !== "string" ||
          !entry.id.trim() ||
          typeof entry.name !== "string" ||
          !entry.name.trim() ||
          typeof entry.slug !== "string" ||
          !entry.slug.trim() ||
          !(entry.source_count > 0)
        )
          throw Error("Populated source-linked public directory proof failed.");
      }
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  }
  const collection = entry.type === "person" ? "people" : "organizations";
  const detailResponse = await fetcher(
    `${origin}${prefix}/api/entities/by-slug/${collection}/${encodeURIComponent(entry.slug)}`,
    {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    },
  );
  try {
    if (detailResponse.status !== 200)
      throw Error("Public profile proof failed.");
    const detail = await detailResponse.json();
    const source = detail.sources?.[0];
    let sourceUrl;
    try {
      sourceUrl = new URL(source?.url);
    } catch {
      /* Explicit rejection below. */
    }
    if (
      detail.id !== entry.id ||
      detail.name !== entry.name ||
      !(detail.source_count > 0) ||
      typeof source?.title !== "string" ||
      !source.title.trim() ||
      !sourceUrl ||
      !["https:", "http:"].includes(sourceUrl.protocol) ||
      sourceUrl.username ||
      sourceUrl.password
    )
      throw Error("Public profile source receipt proof failed.");
  } finally {
    await detailResponse.body?.cancel().catch(() => {});
  }
  for (const path of ["/mcp", "/mcp/"]) {
    const response = await fetcher(`${origin}${prefix}${path}`, {
      method: "POST",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    try {
      if (
        response.status !== 401 ||
        !response.headers.get("www-authenticate")?.startsWith("Bearer ")
      )
        throw Error("Public MCP authorization challenge failed.");
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  }
}

/** Route only this verified API release, retaining the exact ID for recovery.
 * Readers regain the directory without altering DNS or another service's route. */
export async function changePublicApiRouting({
  mode,
  manifest,
  artifact,
  zoneId,
  publicHostname,
  operationsHostname,
  access,
  journal,
  checkpoint,
  apply = false,
  env = process.env,
  cloudflare = cloudflareCommand,
  fetcher = fetch,
  routeApi,
  requireCanonical = false,
  now = Date.now,
}) {
  const cf = (args, options) => cloudflare(args, { ...options, env });
  const ops = manifest?.operations;
  if (
    !["verify", "promote", "restore"].includes(mode) ||
    manifest?.target !== "production" ||
    !["verified-active", "verified-paused"].includes(manifest.status) ||
    !manifest.runtimeReleases?.api ||
    !manifest.runtimeReleases?.discovery ||
    ["api", "discovery"].some(
      (role) =>
        manifest.runtimeReleases[role].releaseSha !== manifest.releaseSha ||
        manifest.runtimeReleases[role].workerName !==
          `atlas-${role}-production`,
    ) ||
    !/^[a-f0-9]{40}$/.test(manifest.releaseSha ?? "") ||
    !env.CLOUDFLARE_API_TOKEN?.trim() ||
    env.CLOUDFLARE_ACCOUNT_ID !== manifest.accountId ||
    !ID.test(zoneId ?? "") ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(publicHostname ?? "") ||
    operationsHostname !== ops?.hostname ||
    ops?.workerName !== "atlas-api-ops-production" ||
    publicHostname === operationsHostname ||
    !VERSION.test(ops.workerVersionId ?? "") ||
    !access?.id ||
    !access.client_id ||
    !access.client_secret ||
    (apply && typeof checkpoint !== "function")
  )
    throw Error(
      "Exact verified production API, edge identity and existing Access credentials are required.",
    );
  if (
    digestDirectory(join(artifact, ".cloudflare/output/v0")) !==
    ops.artifactDigest
  )
    throw Error("Retained public edge artifact changed.");
  await readBuildOutput(artifact);
  const assertVersions = () => {
    assertRuntimeDeployments(manifest.runtimeReleases, cf);
    const versions = cf([
      "workers",
      "deployments",
      "list",
      "--worker",
      ops.workerName,
    ]).deployments?.[0]?.versions;
    if (
      versions?.length !== 1 ||
      versions[0].percentage !== 100 ||
      versions[0].version_id !== ops.workerVersionId
    )
      throw Error("Public edge version changed; routing was refused.");
  };
  assertVersions();
  const policy = cf([
    "zero-trust",
    "access",
    "applications",
    "get",
    ops.accessAppId,
  ]);
  assertAccessPolicy(policy, policy.policies, operationsHostname, access.id);
  const identity = routingIdentity(manifest, zoneId, publicHostname);
  // Directory readers do not depend on discovery alarms. Prove the HTTP
  // experience while consumers stay paused, without touching public routes.
  if (mode === "verify") {
    if (requireCanonical && !journal)
      throw Error(
        "The exact original canonical API routing journal is required.",
      );
    let assertRoute;
    if (journal) {
      assertRoutingContinuity(journal, identity);
      const routes = routeApi ?? routeClient(zoneId, env);
      assertRoute = async () => {
        const matching = (await routes.list()).filter((row) =>
          matchesHost(row.pattern, publicHostname),
        );
        if (
          matching.length !== 1 ||
          matching[0].id !== journal.routeId ||
          matching[0].pattern !== `${publicHostname}/*` ||
          matching[0].script !== ops.workerName
        )
          throw Error(
            "Canonical API route ownership changed; verification was refused.",
          );
      };
      await assertRoute();
    }
    await probePublicApi({
      origin: `https://${operationsHostname}`,
      prefix: "/public-api",
      headers: {
        "CF-Access-Client-Id": access.client_id,
        "CF-Access-Client-Secret": access.client_secret,
      },
      fetcher,
    });
    if (assertRoute)
      await probePublicApi({ origin: `https://${publicHostname}`, fetcher });
    assertVersions();
    if (assertRoute) {
      await assertRoute();
      // A fresh receipt protects profile readers after an API upgrade without
      // relabeling the original route-removal journal or changing its recovery guards.
      return {
        schemaVersion: 1,
        kind: "cloudflare-api-routing-verification",
        status: "verified-canonical",
        ...identity,
        runtimeReleases: structuredClone(manifest.runtimeReleases),
        routeId: journal.routeId,
        routingJournalDigest: canonicalDigest(journal),
        verifiedAt: new Date(now()).toISOString(),
      };
    }
    return { status: "verified-protected", releaseSha: manifest.releaseSha };
  }
  const routes = routeApi ?? routeClient(zoneId, env);
  const pattern = `${publicHostname}/*`;
  const operationId = canonicalDigest(identity);
  const phases = [
    "prepared",
    "route-attach-intent",
    "attached",
    "verified",
    "restore-intent",
    "restored",
  ];
  if (journal) {
    const { routes: snapshotRoutes, ...snapshotIdentity } =
      journal.snapshot ?? {};
    if (
      journal.schemaVersion !== 1 ||
      journal.operationId !== operationId ||
      canonicalDigest(snapshotIdentity) !== operationId ||
      canonicalDigest(journal.snapshot) !== journal.snapshotDigest ||
      !Array.isArray(snapshotRoutes) ||
      snapshotRoutes.some((row) => matchesHost(row.pattern, publicHostname)) ||
      !phases.includes(journal.phase) ||
      (journal.routeId !== undefined && !ID.test(journal.routeId)) ||
      (["attached", "verified"].includes(journal.phase) && !journal.routeId)
    )
      throw Error(
        "Public API recovery journal is invalid or belongs to another release.",
      );
  } else {
    if (mode === "restore")
      throw Error("The exact retained public API routing journal is required.");
    const before = await routes.list();
    if (before.some((row) => matchesHost(row.pattern, publicHostname)))
      throw Error(
        "Canonical API already has a Worker route; routing was refused.",
      );
    const snapshot = { ...identity, routes: sorted(before) };
    journal = {
      schemaVersion: 1,
      operationId,
      snapshot,
      snapshotDigest: canonicalDigest(snapshot),
      phase: "prepared",
    };
  }
  const save = async (phase, routeId = journal.routeId) => {
    journal = {
      ...journal,
      ...(routeId ? { routeId } : {}),
      phase,
      updatedAt: new Date().toISOString(),
    };
    await checkpoint(structuredClone(journal));
  };
  const retainedRoute = async () => {
    const matching = (await routes.list()).filter((row) =>
      matchesHost(row.pattern, publicHostname),
    );
    if (
      matching.length > 1 ||
      matching.some(
        (row) =>
          row.pattern !== pattern ||
          row.script !== ops.workerName ||
          (journal.routeId && row.id !== journal.routeId),
      )
    )
      throw Error(
        "Canonical API route ownership changed; routing was refused.",
      );
    if (matching.length && journal.phase === "prepared")
      throw Error(
        "Canonical API route appeared before this operation's intent.",
      );
    return matching[0];
  };
  if (mode === "promote") {
    if (["restore-intent", "restored"].includes(journal.phase))
      throw Error("A recovery journal cannot be reused for promotion.");
    await probePublicApi({
      origin: `https://${operationsHostname}`,
      prefix: "/public-api",
      headers: {
        "CF-Access-Client-Id": access.client_id,
        "CF-Access-Client-Secret": access.client_secret,
      },
      fetcher,
    });
    let current = await retainedRoute();
    if (!current && ["attached", "verified"].includes(journal.phase))
      throw Error("Retained API route disappeared; promotion was refused.");
    if (!apply) return { ...identity, status: "ready", journal };
    assertVersions();
    if (!current) {
      await save("route-attach-intent");
      current = await retainedRoute();
      if (!current) {
        current = await routes.create({ pattern, script: ops.workerName });
        if (!ID.test(current?.id ?? ""))
          throw Error(
            "Created API route ID was not returned; reconcile the retained intent journal.",
          );
      }
    }
    await save("attached", current.id);
    assertVersions();
    if (!(await retainedRoute()))
      throw Error("Public API route owner readback failed.");
    await probePublicApi({ origin: `https://${publicHostname}`, fetcher });
    assertVersions();
    await save("verified");
    return { ...identity, status: "verified", journal };
  }
  const current = await retainedRoute();
  if (!apply) return { ...identity, status: "recovery-ready", journal };
  assertVersions();
  await save("restore-intent", current?.id);
  const rechecked = await retainedRoute();
  if (rechecked) await routes.delete(rechecked.id);
  assertVersions();
  if (
    (await routes.list()).some((row) =>
      matchesHost(row.pattern, publicHostname),
    )
  )
    throw Error("Public API routing recovery readback failed.");
  await save("restored");
  return { ...identity, status: "restored-routing", journal };
}

export async function publicRoutingCli(
  args = process.argv.slice(2),
  env = process.env,
) {
  const value = (key) => {
    const i = args.indexOf(key);
    if (i < 0 || !args[i + 1] || args[i + 1].startsWith("--"))
      throw Error(`${key} is required.`);
    return args[i + 1];
  };
  const journalFile = resolve(value("--journal")),
    accessFile = value("--access-file");
  const stat = lstatSync(accessFile);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw Error("Private Access file required.");
  const checkpoint = (journal) => {
    mkdirSync(resolve(journalFile, ".."), { recursive: true });
    const file = `${journalFile}.tmp`;
    writeFileSync(file, JSON.stringify(journal, null, 2) + "\n", {
      mode: 0o600,
      flush: true,
    });
    renameSync(file, journalFile);
  };
  return changePublicApiRouting({
    mode: value("--mode"),
    manifest: read(value("--manifest")),
    artifact: resolve(value("--artifact")),
    zoneId: value("--zone-id"),
    publicHostname: value("--public-hostname"),
    operationsHostname: value("--operations-hostname"),
    access: read(accessFile),
    journal: existsSync(journalFile) ? read(journalFile) : undefined,
    checkpoint,
    apply: args.includes("--apply"),
    requireCanonical: args.includes("--require-canonical"),
    env,
  });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  publicRoutingCli()
    .then((r) => console.log(JSON.stringify(r)))
    .catch(() => {
      console.error(
        "Public API routing failed; inspect the retained routing journal. Private provider diagnostics suppressed.",
      );
      process.exitCode = 1;
    });
