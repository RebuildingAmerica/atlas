#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareCommand } from "./cloudflare-cli.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
function validateInput({
  target,
  hostname,
  owner,
  project,
  team,
  accountId,
  zoneId,
}) {
  if (
    !["staging", "production"].includes(target) ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(hostname ?? "") ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner ?? "") ||
    !/^prj_\w+$/.test(project ?? "") ||
    !/^team_\w+$/.test(team ?? "") ||
    !/^[a-f0-9]{32}$/.test(accountId ?? "") ||
    !/^[a-f0-9]{32}$/.test(zoneId ?? "")
  )
    throw new Error(
      "Explicit environment, hostname, rollback owner and provider identities are required.",
    );
}
function validateDns(record, hostname) {
  if (
    !record ||
    !/^[a-f0-9]{32}$/.test(record.id ?? "") ||
    record.name !== hostname ||
    record.type !== "CNAME" ||
    record.proxied !== false ||
    !/^[a-z0-9.-]+\.vercel-dns(?:-\d+)?\.com$/.test(record.content ?? "") ||
    !Number.isInteger(record.ttl) ||
    record.ttl < 1
  )
    throw new Error(
      "Rollback capture requires the current unproxied Vercel CNAME.",
    );
}

/** Read the active alias, immutable deployment and DNS before any domain switch. */
export async function captureVercelRollback({
  target,
  hostname,
  owner,
  project,
  team,
  token,
  accountId,
  zoneId,
  cloudflare = cloudflareCommand,
  fetcher = fetch,
  now = () => new Date(),
}) {
  validateInput({ target, hostname, owner, project, team, accountId, zoneId });
  if (!token?.trim())
    throw new Error("Existing Vercel authentication is required.");
  const zone = cloudflare(["zones", "get", "--zone", zoneId]);
  if (
    zone.id !== zoneId ||
    zone.account?.id !== accountId ||
    !hostname.endsWith("." + zone.name)
  )
    throw new Error("Rollback hostname and zone/account do not match.");
  const records = cloudflare([
    "dns",
    "records",
    "list",
    "--zone",
    zoneId,
    "--name",
    hostname,
    "--per-page",
    "100",
  ]);
  if (
    !Array.isArray(records) ||
    records.length >= 100 ||
    records.some(
      (row) =>
        row.name !== hostname ||
        !["CNAME", "MX", "TXT", "CAA"].includes(row.type),
    ) ||
    records.filter((row) => row.type === "CNAME").length !== 1
  )
    throw new Error(
      "Exactly one routing CNAME and complete coexisting DNS inventory are required.",
    );
  const record = records.find((row) => row.type === "CNAME");
  validateDns(record, hostname);
  async function read(path) {
    const url = new URL(path, "https://api.vercel.com");
    url.searchParams.set("teamId", team);
    const response = await fetcher(url.href, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error("Vercel rollback inventory is unavailable.");
    return response.json();
  }
  const alias = await read(`/v4/aliases/${encodeURIComponent(hostname)}`);
  if (
    alias.alias !== hostname ||
    alias.projectId !== project ||
    alias.redirect ||
    !/^dpl_\w+$/.test(alias.deploymentId ?? "")
  )
    throw new Error(
      "Current alias does not identify the intended Atlas deployment.",
    );
  const deployment = await read(`/v13/deployments/${alias.deploymentId}`);
  if (
    deployment.id !== alias.deploymentId ||
    deployment.projectId !== project ||
    deployment.readyState !== "READY" ||
    (target === "production" && deployment.target !== "production") ||
    !/^[a-z0-9.-]+\.vercel\.app$/.test(deployment.url ?? "") ||
    !(Array.isArray(deployment.routes) || deployment.routes === null)
  )
    throw new Error(
      "A ready immutable Vercel deployment with readable routing is required.",
    );
  const snapshot = {
    schemaVersion: 1,
    target,
    hostname,
    owner,
    collectedAt: now().toISOString(),
    accountId,
    zoneId,
    dns: Object.fromEntries(
      ["id", "name", "type", "content", "proxied", "ttl"].map((key) => [
        key,
        record[key],
      ]),
    ),
    otherDnsRecords: records
      .filter((row) => row.type !== "CNAME")
      .map((row) =>
        Object.fromEntries(
          ["id", "name", "type", "content", "ttl", "priority"]
            .filter((key) => row[key] !== undefined)
            .map((key) => [key, row[key]]),
        ),
      ),
    vercel: {
      projectId: project,
      teamId: team,
      deploymentId: deployment.id,
      deploymentUrl: `https://${deployment.url}`,
      routingDigest: createHash("sha256")
        .update(JSON.stringify(deployment.routes))
        .digest("hex"),
      routeCount: deployment.routes === null ? null : deployment.routes.length,
      routeInventory:
        deployment.routes === null ? "provider-null" : "explicit-routes",
    },
  };
  validateVercelRollback(snapshot, {
    target,
    hostname,
    owner,
    project,
    team,
    accountId,
    zoneId,
  });
  return snapshot;
}

export function validateVercelRollback(snapshot, expected) {
  validateInput(expected);
  if (
    snapshot.schemaVersion !== 1 ||
    !Number.isFinite(Date.parse(snapshot.collectedAt)) ||
    ["target", "hostname", "owner", "accountId", "zoneId"].some(
      (key) => snapshot[key] !== expected[key],
    ) ||
    snapshot.vercel?.projectId !== expected.project ||
    snapshot.vercel?.teamId !== expected.team ||
    !/^dpl_\w+$/.test(snapshot.vercel?.deploymentId ?? "") ||
    !/^https:\/\/[a-z0-9.-]+\.vercel\.app$/.test(
      snapshot.vercel?.deploymentUrl ?? "",
    ) ||
    !/^[a-f0-9]{64}$/.test(snapshot.vercel?.routingDigest ?? "") ||
    !(
      (snapshot.vercel.routeInventory === "provider-null" &&
        snapshot.vercel.routeCount === null) ||
      (snapshot.vercel.routeInventory === "explicit-routes" &&
        Number.isInteger(snapshot.vercel.routeCount) &&
        snapshot.vercel.routeCount >= 0)
    )
  )
    throw new Error(
      "Rollback recovery identity is invalid or belongs to another environment.",
    );
  validateDns(snapshot.dns, snapshot.hostname);
  if (
    !Array.isArray(snapshot.otherDnsRecords) ||
    snapshot.otherDnsRecords.some(
      (row) =>
        row.name !== snapshot.hostname ||
        !["MX", "TXT", "CAA"].includes(row.type) ||
        !/^[a-f0-9]{32}$/.test(row.id ?? "") ||
        typeof row.content !== "string" ||
        !Number.isInteger(row.ttl) ||
        row.ttl < 1 ||
        (row.type === "MX" &&
          (!Number.isInteger(row.priority) || row.priority < 0)),
    )
  )
    throw new Error("Coexisting DNS recovery records are invalid.");
  return true;
}

async function main() {
  const args = process.argv.slice(2),
    value = (key) =>
      args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const output = resolve(value("--output") ?? "");
  if (!output.startsWith(resolve(ROOT, ".atlas") + sep))
    throw new Error("An ignored .atlas/ output is required.");
  const snapshot = await captureVercelRollback({
    target: value("--target"),
    hostname: value("--hostname"),
    owner: value("--owner"),
    project: value("--project"),
    team: value("--team"),
    token: process.env.VERCEL_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    zoneId: process.env.CLOUDFLARE_ZONE_ID,
  });
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, JSON.stringify(snapshot, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      {
        status: "captured",
        target: snapshot.target,
        hostname: snapshot.hostname,
        deploymentId: snapshot.vercel.deploymentId,
        output,
      },
      null,
      2,
    ),
  );
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch(() => {
    console.error(
      "Rollback capture failed; check exact provider identities, active Vercel alias and unused private output path. Provider diagnostics were suppressed.",
    );
    process.exitCode = 1;
  });
