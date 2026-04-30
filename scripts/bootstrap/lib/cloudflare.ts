import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log, password } from "@clack/prompts";
import pc from "picocolors";
import { runCommand } from "./shell.js";
import { logSubline, promptOrExit } from "./ui.js";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

const PRIMARY_DIR = join(homedir(), ".config", "atlas-bootstrap");
const PRIMARY_TOKEN_PATH = join(PRIMARY_DIR, "cloudflare-token");
const LEGACY_TOKEN_PATH = join(
  homedir(),
  ".config",
  "mcp-publisher",
  "cloudflare-token",
);

export interface AcquiredCloudflareToken {
  token: string;
  source: "env" | "stash" | "prompt";
  stashPath: string | null;
}

export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

export interface UpsertResult {
  ok: boolean;
  recordId?: string;
  created: boolean;
  error?: string;
}

export interface CnameVerification {
  resolved: boolean;
  observed: string | null;
}

// ── Token storage ────────────────────────────────────────────────────────────

export function readStashedToken(): {
  token: string;
  path: string;
} | null {
  for (const path of [PRIMARY_TOKEN_PATH, LEGACY_TOKEN_PATH]) {
    if (!existsSync(path)) continue;
    const value = readFileSync(path, "utf8").trim();
    if (value.length > 0) return { token: value, path };
  }
  return null;
}

export function persistCloudflareToken(token: string): string {
  mkdirSync(PRIMARY_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(PRIMARY_TOKEN_PATH, `${token}\n`, { mode: 0o600 });
  return PRIMARY_TOKEN_PATH;
}

export async function acquireCloudflareToken(opts: {
  envVar?: string;
  zoneHint?: string;
}): Promise<AcquiredCloudflareToken> {
  const envName = opts.envVar ?? "CLOUDFLARE_API_TOKEN";
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) {
    log.info(`Using Cloudflare token from $${envName}`);
    return { token: fromEnv, source: "env", stashPath: null };
  }

  const stashed = readStashedToken();
  if (stashed) {
    log.success(`Reusing stashed Cloudflare token (${pc.dim(stashed.path)})`);
    return { token: stashed.token, source: "stash", stashPath: stashed.path };
  }

  logSubline(
    pc.dim(
      `Create one at https://dash.cloudflare.com/profile/api-tokens (template "Edit zone DNS"${opts.zoneHint ? `, restricted to ${opts.zoneHint}` : ""}).`,
    ),
  );
  const token = (await promptOrExit(
    password({
      message: "Cloudflare API token",
      validate: (v) =>
        v && v.trim().length > 0 ? undefined : "Token is required",
    }),
  )) as string;
  return { token: token.trim(), source: "prompt", stashPath: null };
}

// ── Zone + record helpers ────────────────────────────────────────────────────

export function parentZone(name: string): string {
  const parts = name.split(".");
  if (parts.length <= 2) return name;
  return parts.slice(-2).join(".");
}

export function getZoneId(token: string, domain: string): string | null {
  const zone = parentZone(domain);
  const result = runCommand(
    `curl -s -H "Authorization: Bearer ${shellEscape(token)}" ` +
      `"${CLOUDFLARE_API}/zones?name=${encodeURIComponent(zone)}" ` +
      `| jq -r '.result[0].id // empty'`,
  );
  if (!result.ok) return null;
  const id = result.stdout.trim();
  return id.length > 0 ? id : null;
}

export function findCnameRecord(
  token: string,
  zoneId: string,
  name: string,
): CloudflareDnsRecord | null {
  const result = runCommand(
    `curl -s -H "Authorization: Bearer ${shellEscape(token)}" ` +
      `"${CLOUDFLARE_API}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(name)}" ` +
      `| jq -c '.result[0] // empty'`,
  );
  if (!result.ok || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout) as CloudflareDnsRecord;
  } catch {
    return null;
  }
}

export function upsertCname(
  token: string,
  zoneId: string,
  name: string,
  target: string,
  opts: { proxied?: boolean; comment?: string; ttl?: number } = {},
): UpsertResult {
  const existing = findCnameRecord(token, zoneId, name);
  const body = JSON.stringify({
    type: "CNAME",
    name,
    content: target,
    ttl: opts.ttl ?? 60,
    proxied: opts.proxied ?? false,
    comment: opts.comment ?? "",
  });

  const desiredProxied = opts.proxied ?? false;
  if (existing?.content === target && existing?.proxied === desiredProxied) {
    return { ok: true, recordId: existing.id, created: false };
  }

  const url = existing
    ? `${CLOUDFLARE_API}/zones/${zoneId}/dns_records/${existing.id}`
    : `${CLOUDFLARE_API}/zones/${zoneId}/dns_records`;
  const method = existing ? "PUT" : "POST";

  const result = runCommand(
    `curl -s -X ${method} ` +
      `-H "Authorization: Bearer ${shellEscape(token)}" ` +
      `-H "Content-Type: application/json" ` +
      `-d ${shellSingleQuote(body)} ` +
      `"${url}" ` +
      `| jq -r '.result.id // .errors[0].message // empty'`,
  );
  if (!result.ok || !result.stdout) {
    return {
      ok: false,
      created: false,
      error: result.stderr || "Cloudflare API call failed",
    };
  }
  // jq emits the id on success or the first error message on failure; the id
  // is always 32 hex chars from Cloudflare, so distinguish on shape.
  const out = result.stdout.trim();
  if (/^[0-9a-f]{32}$/i.test(out)) {
    return { ok: true, recordId: out, created: !existing };
  }
  return { ok: false, created: false, error: out };
}

// ── DNS verify ───────────────────────────────────────────────────────────────

export function verifyCname(
  name: string,
  expectedTarget: string,
): CnameVerification {
  const result = runCommand(`dig +short CNAME ${shellEscape(name)} @1.1.1.1`);
  const observed = result.stdout
    .split("\n")
    .map((l) => l.trim().replace(/\.$/, ""))
    .find((l) => l.length > 0);
  const target = expectedTarget.replace(/\.$/, "");
  return {
    resolved: observed === target,
    observed: observed ?? null,
  };
}

// ── Internals ────────────────────────────────────────────────────────────────

function shellEscape(value: string): string {
  // Token / domain — safe characters only.
  if (!/^[\w.@:/-]+$/.test(value)) {
    throw new Error(
      `Refusing to inline value with shell metacharacters: ${value.slice(0, 8)}…`,
    );
  }
  return value;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
