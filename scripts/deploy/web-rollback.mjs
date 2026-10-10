#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareCommand } from "./cloudflare-cli.mjs";
import { prepareCloudflareOutput } from "./web-cloudflare-output.mjs";
import { validateVercelRollback } from "./web-rollback-capture.mjs";
import {
  createWebManifest,
  digestDirectory,
  verifyWebManifest,
} from "./web-release.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dnsFields = (record) =>
  Object.fromEntries(
    ["id", "name", "type", "content", "proxied", "ttl", "priority"]
      .filter(
        (key) =>
          record[key] !== undefined &&
          !(
            key === "proxied" &&
            record[key] === false &&
            record.type !== "CNAME"
          ),
      )
      .map((key) => [key, record[key]]),
  );
const sorted = (records) =>
  records.map(dnsFields).sort((a, b) => a.id.localeCompare(b.id));

export function webRollbackOperationId(snapshot, deployment) {
  return digest({
    snapshot,
    workerName: deployment.workerName,
    workerVersionId: deployment.workerVersionId,
    artifactDigest: deployment.artifactDigest,
    assetsDigest: deployment.assetsDigest,
  });
}

/** Restore the retained host so sign-in and source-linked profiles can recover together. */
export async function restoreVercelRouting({
  snapshot,
  deployment,
  expected,
  token,
  apply = false,
  journal,
  checkpoint,
  applyDomains,
  cloudflare = cloudflareCommand,
  fetcher = fetch,
}) {
  validateVercelRollback(snapshot, expected);
  const hostname = snapshot.hostname;
  const candidate = `${deployment.workerName}.${hostname}`;
  if (
    snapshot.target !== "production" ||
    deployment.target !== snapshot.target ||
    deployment.workerName !== createWebManifest(deployment).workerName ||
    deployment.accountId !== snapshot.accountId ||
    deployment.zoneId !== snapshot.zoneId ||
    deployment.candidateUrl !== `https://${candidate}` ||
    deployment.publicEnv?.ATLAS_PUBLIC_URL !== `https://${hostname}` ||
    deployment.publicEnv?.ATLAS_WEB_CANONICAL_URL !== `https://${hostname}` ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      deployment.workerVersionId ?? "",
    ) ||
    !/^[a-f0-9]{64}$/.test(deployment.artifactDigest ?? "") ||
    !/^[a-f0-9]{64}$/.test(deployment.assetsDigest ?? "") ||
    !token?.trim()
  )
    throw new Error(
      "Exact production release, account and retained Vercel authentication are required.",
    );
  const operationId = webRollbackOperationId(snapshot, deployment);
  if (
    journal &&
    (journal.operationId !== operationId ||
      !["prepared", "detached", "restored"].includes(journal.phase))
  )
    throw new Error(
      "Recovery journal belongs to a different routing operation.",
    );
  const zone = cloudflare(["zones", "get", "--zone", snapshot.zoneId]);
  if (
    zone.id !== snapshot.zoneId ||
    zone.account?.id !== snapshot.accountId ||
    !hostname.endsWith("." + zone.name)
  )
    throw new Error("Recovery zone and account readback failed.");
  const active = cloudflare([
    "workers",
    "deployments",
    "list",
    "--worker",
    deployment.workerName,
  ]).deployments?.[0]?.versions;
  if (
    active?.length !== 1 ||
    active[0].percentage !== 100 ||
    active[0].version_id !== deployment.workerVersionId
  )
    throw new Error(
      "Active Worker version differs from the release being rolled back.",
    );
  const readDomains = () => {
    const worker = cloudflare(["workers", "get", deployment.workerName]);
    const domains = worker.references?.domains;
    if (
      worker.name !== deployment.workerName ||
      !Array.isArray(domains) ||
      !domains.some((domain) => domain.hostname === candidate) ||
      domains.some(
        (domain) =>
          domain.zone_id !== snapshot.zoneId ||
          ![hostname, candidate].includes(domain.hostname),
      )
    )
      throw new Error(
        "Worker domain ownership differs from the rollback release.",
      );
    return domains.map((domain) => domain.hostname);
  };
  const domains = readDomains();
  if (!domains.includes(hostname) && !journal)
    throw new Error(
      "An interrupted domain removal requires its exact recovery journal.",
    );
  const readDns = () => {
    const rows = cloudflare([
      "dns",
      "records",
      "list",
      "--zone",
      snapshot.zoneId,
      "--name",
      hostname,
      "--per-page",
      "100",
    ]);
    if (
      !Array.isArray(rows) ||
      rows.length >= 100 ||
      rows.some((row) => row.name !== hostname)
    )
      throw new Error("Complete routing DNS inventory is required.");
    const mail = rows.filter((row) => !["CNAME", "AAAA"].includes(row.type));
    if (
      JSON.stringify(sorted(mail)) !==
      JSON.stringify(sorted(snapshot.otherDnsRecords))
    )
      throw new Error(
        "Mail or verification DNS changed since the recovery snapshot.",
      );
    const routing = rows.filter((row) => ["CNAME", "AAAA"].includes(row.type));
    if (
      routing.length > 1 ||
      routing.some(
        (row) =>
          !/^[a-f0-9]{32}$/.test(row.id ?? "") ||
          !(
            (row.type === "AAAA" &&
              row.content === "100::" &&
              row.proxied === true) ||
            (row.type === "CNAME" &&
              row.content === snapshot.dns.content &&
              row.proxied === false &&
              row.ttl === snapshot.dns.ttl)
          ),
      )
    )
      throw new Error(
        "Unrecognized routing DNS cannot be replaced automatically.",
      );
    return routing;
  };
  readDns();
  async function readVercel(path) {
    const url = new URL(path, "https://api.vercel.com");
    url.searchParams.set("teamId", expected.team);
    const response = await fetcher(url.href, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error("Retained Vercel recovery target is unavailable.");
    return response.json();
  }
  const alias = await readVercel(`/v4/aliases/${hostname}`);
  const retained = await readVercel(
    `/v13/deployments/${snapshot.vercel.deploymentId}`,
  );
  if (
    alias.alias !== hostname ||
    alias.projectId !== expected.project ||
    alias.deploymentId !== retained.id ||
    alias.redirect ||
    retained.id !== snapshot.vercel.deploymentId ||
    retained.projectId !== expected.project ||
    retained.readyState !== "READY" ||
    retained.target !== "production" ||
    `https://${retained.url}` !== snapshot.vercel.deploymentUrl ||
    digest(retained.routes) !== snapshot.vercel.routingDigest
  )
    throw new Error(
      "The retained Vercel alias, deployment or routing changed.",
    );
  if (!apply)
    return {
      status: "ready",
      hostname,
      workerName: deployment.workerName,
      deploymentId: retained.id,
      operationId,
    };
  if (typeof checkpoint !== "function" || typeof applyDomains !== "function")
    throw new Error(
      "Durable recovery checkpoints and cf domain application are required.",
    );
  checkpoint({ operationId, phase: "prepared" });
  if (domains.includes(hostname)) await applyDomains([candidate]);
  if (readDomains().includes(hostname))
    throw new Error("Canonical Worker domain removal was not confirmed.");
  checkpoint({ operationId, phase: "detached" });
  const routing = readDns();
  if (routing[0]?.type !== "CNAME") {
    const { id: _oldId, ...record } = snapshot.dns;
    cloudflare(["dns", "records", "batch", "--zone", snapshot.zoneId], {
      body: {
        deletes: routing.map((row) => ({ id: row.id })),
        posts: [record],
      },
    });
  }
  const restored = readDns();
  if (restored.length !== 1 || restored[0].type !== "CNAME")
    throw new Error("Vercel routing restoration was not confirmed.");
  checkpoint({ operationId, phase: "restored" });
  return {
    status: "routing-restored",
    hostname,
    deploymentId: retained.id,
    operationId,
    journeys: "Immediate production journey verification is required.",
  };
}

/** cf triggers changes only domains: it never rebuilds or uploads a Worker version. */
export async function applyRecoveryDomains({
  directory,
  deployment,
  domains,
  env = process.env,
  runner = spawnSync,
}) {
  const temporary = mkdtempSync(join(tmpdir(), "atlas-rollback-domains-"));
  try {
    await prepareCloudflareOutput({
      directory,
      architecture: deployment.architecture,
      outputRoot: temporary,
      accountId: deployment.accountId,
      workerName: deployment.workerName,
      workerEnv: {},
      domains,
    });
    const result = runner(
      process.execPath,
      [
        join(ROOT, "node_modules/cf/bin/cf"),
        "workers",
        "triggers",
        "deploy",
        "--prebuilt",
        ...(deployment.architecture === "workers"
          ? ["--mode", "production"]
          : []),
        ...(!env.CLOUDFLARE_API_TOKEN
          ? ["--profile", env.ATLAS_CF_PROFILE]
          : []),
      ],
      { cwd: temporary, env, encoding: "utf8", timeout: 120000 },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        "cf recovery domain application failed; provider diagnostics suppressed.",
      );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2),
    value = (key) =>
      args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  if (!value("--directory") || !value("--snapshot"))
    throw new Error(
      "Explicit release directory and Vercel snapshot are required.",
    );
  const directory = resolve(value("--directory"));
  if (
    !directory.startsWith(join(ROOT, ".atlas") + sep) ||
    realpathSync(directory) !== directory
  )
    throw new Error(
      "An ignored .atlas release directory without symbolic links is required.",
    );
  const deployment = JSON.parse(
    readFileSync(join(directory, "deployment.json"), "utf8"),
  );
  verifyWebManifest(deployment, {
    releaseSha: deployment.releaseSha,
    artifactDigest: digestDirectory(join(directory, "artifact")),
    assetsDigest: digestDirectory(join(directory, "assets")),
  });
  const snapshot = JSON.parse(readFileSync(value("--snapshot"), "utf8"));
  const file = join(directory, "routing-rollback.json");
  if (existsSync(file) && realpathSync(file) !== file)
    throw new Error("Recovery journal cannot be a symbolic link.");
  if (
    process.env.CLOUDFLARE_ACCOUNT_ID !== deployment.accountId ||
    (!process.env.CLOUDFLARE_API_TOKEN && !process.env.ATLAS_CF_PROFILE)
  )
    throw new Error(
      "Explicit matching Cloudflare account and authentication are required.",
    );
  console.log(
    JSON.stringify(
      await restoreVercelRouting({
        snapshot,
        deployment,
        expected: {
          target: value("--target"),
          hostname: value("--hostname"),
          owner: value("--owner"),
          project: value("--project"),
          team: value("--team"),
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          zoneId: process.env.CLOUDFLARE_ZONE_ID,
        },
        token: process.env.VERCEL_TOKEN,
        apply: args.includes("--apply"),
        journal: existsSync(file)
          ? JSON.parse(readFileSync(file, "utf8"))
          : undefined,
        checkpoint: (entry) => {
          const temporary = join(directory, `.rollback-${randomUUID()}.json`);
          try {
            writeFileSync(temporary, JSON.stringify(entry) + "\n", {
              mode: 0o600,
              flag: "wx",
              flush: true,
            });
            renameSync(temporary, file);
          } finally {
            rmSync(temporary, { force: true });
          }
        },
        applyDomains: (domains) =>
          applyRecoveryDomains({ directory, deployment, domains }),
      }),
      null,
      2,
    ),
  );
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch(() => {
    console.error(
      "Routing rollback failed; verify the retained snapshot, exact release, journal and provider access. Provider details were suppressed.",
    );
    process.exitCode = 1;
  });
