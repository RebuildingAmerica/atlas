import { existsSync } from "node:fs";
import path from "node:path";
import { log, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../lib/types.js";
import { commandOutput, runCommand } from "../lib/shell.js";
import { logSubline, promptConfirm } from "../lib/ui.js";
import { parseEnvFile } from "../lib/env-file.js";
import {
  acquireCloudflareToken,
  findCnameRecord,
  getZoneId,
  parentZone,
  persistCloudflareToken,
  upsertCname,
} from "../lib/cloudflare.js";
import type { ApiDomainTarget } from "./api-domain.js";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const CLOUD_RUN_CNAME_TARGET = "ghs.googlehosted.com";
const DEFAULT_REGION = "us-central1";

const TARGETS: Record<ApiDomainTarget, { domain: string; service: string }> = {
  prod: {
    domain: "atlas-api.rebuildingus.org",
    service: "atlas-api",
  },
  staging: {
    domain: "atlas-api-staging.rebuildingus.org",
    service: "atlas-api-staging",
  },
};

const EDGE_RATE_LIMIT_RULE_DESCRIPTIONS = new Set([
  "Atlas anonymous API reads",
  "Atlas anonymous API writes",
  "Atlas anonymous sustained API traffic",
  "Atlas credentialed API pre-auth traffic",
  "Atlas credentialed sustained API pre-auth traffic",
  "Atlas API origin abuse backstop",
]);
const EDGE_TRANSFORM_RULE_DESCRIPTIONS = new Set([
  "Atlas API origin identity headers",
]);

interface ApiEdgeConfig {
  target: ApiDomainTarget;
  domain: string;
  service: string;
  region: string;
  project: string;
  edgeOriginSecret: string;
}

interface CloudflareError {
  code: number;
  message: string;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result?: T;
  errors?: CloudflareError[];
}

interface CloudflareApiResult<T> {
  ok: boolean;
  status: number;
  value: T | null;
  error: string | null;
}

interface CloudflareResponseParameters {
  content: string;
  content_type: string;
  status_code: number;
}

interface CloudflareHeaderTransformParameters {
  expression?: string;
  operation: string;
  value?: string;
}

interface CloudflareActionParameters {
  headers?: Record<string, CloudflareHeaderTransformParameters>;
  response?: CloudflareResponseParameters;
}

interface CloudflareRateLimitParameters {
  characteristics: string[];
  mitigation_timeout: number;
  period: number;
  requests_per_period: number;
  requests_to_origin: boolean;
}

interface CloudflareRateLimitRule {
  [key: string]: unknown;
  action: string;
  action_parameters?: CloudflareActionParameters;
  description: string;
  enabled: boolean;
  expression: string;
  ratelimit?: CloudflareRateLimitParameters;
  ref?: string;
}

interface CloudflareRuleset {
  description?: string;
  id: string;
  kind: string;
  name: string;
  phase: string;
  rules?: CloudflareRateLimitRule[];
}

interface RulesetLookup {
  ok: boolean;
  ruleset: CloudflareRuleset | null;
  error: string | null;
}

interface EdgeRuleResult {
  ok: boolean;
  created: boolean;
  changed: boolean;
  error: string | null;
}

interface HealthProbe {
  healthy: boolean;
  statusCode: number | null;
  viaCloudflare: boolean;
  output: string;
}

export async function runApiEdgePhase(
  projectRoot: string,
  doctorMode: boolean,
  target: ApiDomainTarget = "prod",
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  const config = readConfig(projectRoot, target);
  if (!config) {
    log.error("Could not determine GCP project (set GCP_PROJECT_ID in .env).");
    followUpItems.push(
      "Set GCP_PROJECT_ID in .env / .env.production before running --api-edge",
    );
    return { success: false, followUpItems };
  }
  if (!config.edgeOriginSecret) {
    log.error(
      "ATLAS_EDGE_ORIGIN_SECRET is required before enabling API edge protection.",
    );
    followUpItems.push(
      "Set ATLAS_EDGE_ORIGIN_SECRET to a long random secret in .env / .env.production and in the hosted API environment.",
    );
    return { success: false, followUpItems };
  }

  log.step(
    `Configuring Cloudflare edge protection for ${pc.cyan(config.domain)} (${target})`,
  );

  const acquired = await acquireCloudflareToken({
    permissionsHint:
      'with Zone DNS Edit, Zone WAF Edit, Transform Rules Edit, and Rulesets Read permissions for the "rebuildingus.org" zone',
    zoneHint: parentZone(config.domain),
  });
  const zoneId = getZoneId(acquired.token, config.domain);
  if (!zoneId) {
    log.error(
      `Could not find Cloudflare zone for ${parentZone(config.domain)}. Is the API token scoped to that zone?`,
    );
    followUpItems.push(
      `Verify the Cloudflare API token has DNS and WAF edit access to ${parentZone(config.domain)}`,
    );
    return { success: false, followUpItems };
  }

  if (doctorMode) {
    return await reportStatus(acquired.token, zoneId, config);
  }

  const proceed = await promptConfirm(
    `Enable Cloudflare proxy + anonymous API rate-limit rules for ${pc.cyan(config.domain)}?`,
    true,
  );
  if (!proceed) {
    followUpItems.push(
      `Re-run \`pnpm bootstrap --api-edge${
        config.target === "staging" ? " --target staging" : ""
      }\` when ready to enable Cloudflare edge protection.`,
    );
    return { success: true, followUpItems };
  }

  const preflight = preflightCanonicalDomain(config);
  if (!preflight.healthy) {
    log.error(`https://${config.domain}/health is not healthy yet.`);
    logSubline(pc.dim(preflight.output || "no response"));
    followUpItems.push(
      `Run \`pnpm bootstrap --api-domain${
        config.target === "staging" ? " --target staging" : ""
      }\` and wait for https://${config.domain}/health to return 200 before enabling edge proxying.`,
    );
    return { success: false, followUpItems };
  }

  const proxyResult = enableCloudflareProxy(
    acquired.token,
    zoneId,
    config,
    followUpItems,
  );
  if (!proxyResult) {
    return { success: false, followUpItems };
  }

  const rulesResult = await ensureRateLimitRules(
    acquired.token,
    zoneId,
    config.domain,
  );
  if (!rulesResult.ok) {
    log.error(rulesResult.error ?? "Cloudflare rate-limit rule update failed");
    followUpItems.push(
      `Create Cloudflare WAF rate limiting rules for ${config.domain} in the http_ratelimit phase.`,
    );
    return { success: false, followUpItems };
  }
  log.success(
    rulesResult.created
      ? "Cloudflare rate-limit ruleset created."
      : rulesResult.changed
        ? "Cloudflare rate-limit rules updated."
        : "Cloudflare rate-limit rules already current.",
  );

  const transformResult = await ensureTransformRules(
    acquired.token,
    zoneId,
    config,
  );
  if (!transformResult.ok) {
    log.error(
      transformResult.error ?? "Cloudflare transform rule update failed",
    );
    followUpItems.push(
      `Create Cloudflare request header transform rules for ${config.domain} in the http_request_late_transform phase.`,
    );
    return { success: false, followUpItems };
  }
  log.success(
    transformResult.created
      ? "Cloudflare origin identity transform ruleset created."
      : transformResult.changed
        ? "Cloudflare origin identity transform rules updated."
        : "Cloudflare origin identity transform rules already current.",
  );

  const edgeProbe = await waitForCloudflareHealth(config.domain);
  if (!edgeProbe.healthy || !edgeProbe.viaCloudflare) {
    log.error(`Cloudflare proxy probe for ${config.domain} did not pass.`);
    logSubline(pc.dim(edgeProbe.output || "no response"));
    followUpItems.push(
      `Check Cloudflare DNS proxy status and probe https://${config.domain}/health; expected HTTP 200 with Cloudflare response headers.`,
    );
    return { success: false, followUpItems };
  }

  if (acquired.source === "prompt") {
    const stash = await promptConfirm(
      "Save the Cloudflare token to ~/.config/atlas-bootstrap/cloudflare-token (chmod 600) so future bootstrap runs don't re-prompt?",
      true,
    );
    if (stash) {
      const saved = persistCloudflareToken(acquired.token);
      log.success(`Token saved to ${pc.dim(saved)}`);
    } else {
      followUpItems.push(
        "Cloudflare token not saved; --api-edge will re-prompt next run.",
      );
    }
  }

  log.success(
    `Cloudflare edge protection ready: ${pc.cyan(`https://${config.domain}`)}`,
  );
  return { success: true, followUpItems };
}

function enableCloudflareProxy(
  token: string,
  zoneId: string,
  config: ApiEdgeConfig,
  followUpItems: string[],
): boolean {
  const existing = findCnameRecord(token, zoneId, config.domain);
  if (existing && existing.content !== CLOUD_RUN_CNAME_TARGET) {
    log.error(
      `Cloudflare CNAME ${config.domain} points to ${existing.content}, expected ${CLOUD_RUN_CNAME_TARGET}.`,
    );
    followUpItems.push(
      `Fix CNAME ${config.domain} to point at ${CLOUD_RUN_CNAME_TARGET} before enabling Cloudflare proxying.`,
    );
    return false;
  }

  const s = spinner();
  s.start(`Enabling Cloudflare proxy for ${config.domain}...`);
  const upsert = upsertCname(
    token,
    zoneId,
    config.domain,
    CLOUD_RUN_CNAME_TARGET,
    {
      comment: `Cloud Run edge protection for ${config.service}`,
      proxied: true,
      ttl: 1,
    },
  );
  if (!upsert.ok) {
    s.stop("Failed to enable Cloudflare proxy");
    log.error(upsert.error ?? "Cloudflare DNS update failed");
    followUpItems.push(
      `Enable the orange-cloud proxy on CNAME ${config.domain} in Cloudflare.`,
    );
    return false;
  }
  s.stop(
    upsert.created
      ? `Cloudflare proxied CNAME created (${pc.dim(upsert.recordId ?? "?")})`
      : `Cloudflare proxy already enabled (${pc.dim(upsert.recordId ?? "?")})`,
  );
  return true;
}

async function ensureRateLimitRules(
  token: string,
  zoneId: string,
  domain: string,
): Promise<EdgeRuleResult> {
  const lookup = await getRateLimitRuleset(token, zoneId);
  if (!lookup.ok) {
    return {
      ok: false,
      created: false,
      changed: false,
      error: lookup.error,
    };
  }

  const desiredRules = buildRateLimitRules(domain);
  if (!lookup.ruleset) {
    const create = await cloudflareRequest<CloudflareRuleset>(
      token,
      `/zones/${zoneId}/rulesets`,
      {
        body: JSON.stringify({
          description: "Atlas API anonymous edge rate limits",
          kind: "zone",
          name: "Atlas API edge rate limits",
          phase: "http_ratelimit",
          rules: desiredRules,
        }),
        method: "POST",
      },
    );
    return {
      ok: create.ok,
      created: create.ok,
      changed: create.ok,
      error: create.error,
    };
  }

  const preservedRules = (lookup.ruleset.rules ?? [])
    .filter((rule) => !EDGE_RATE_LIMIT_RULE_DESCRIPTIONS.has(rule.description))
    .map(stripCloudflareReadOnlyFields);
  const nextRules = [...preservedRules, ...desiredRules];
  if (
    JSON.stringify(comparableRules(lookup.ruleset.rules ?? [])) ===
    JSON.stringify(comparableRules(nextRules))
  ) {
    return { ok: true, created: false, changed: false, error: null };
  }

  const update = await cloudflareRequest<CloudflareRuleset>(
    token,
    `/zones/${zoneId}/rulesets/${lookup.ruleset.id}`,
    {
      body: JSON.stringify({
        description:
          lookup.ruleset.description ?? "Atlas API anonymous edge rate limits",
        kind: lookup.ruleset.kind,
        name: lookup.ruleset.name,
        phase: lookup.ruleset.phase,
        rules: nextRules,
      }),
      method: "PUT",
    },
  );
  return {
    ok: update.ok,
    created: false,
    changed: update.ok,
    error: update.error,
  };
}

async function ensureTransformRules(
  token: string,
  zoneId: string,
  config: ApiEdgeConfig,
): Promise<EdgeRuleResult> {
  const lookup = await getTransformRuleset(token, zoneId);
  if (!lookup.ok) {
    return {
      ok: false,
      created: false,
      changed: false,
      error: lookup.error,
    };
  }

  const desiredRules = buildTransformRules(config);
  if (!lookup.ruleset) {
    const create = await cloudflareRequest<CloudflareRuleset>(
      token,
      `/zones/${zoneId}/rulesets`,
      {
        body: JSON.stringify({
          description: "Atlas API origin identity headers",
          kind: "zone",
          name: "Atlas API origin identity headers",
          phase: "http_request_late_transform",
          rules: desiredRules,
        }),
        method: "POST",
      },
    );
    return {
      ok: create.ok,
      created: create.ok,
      changed: create.ok,
      error: create.error,
    };
  }

  const preservedRules = (lookup.ruleset.rules ?? [])
    .filter((rule) => !EDGE_TRANSFORM_RULE_DESCRIPTIONS.has(rule.description))
    .map(stripCloudflareReadOnlyFields);
  const nextRules = [...preservedRules, ...desiredRules];
  if (
    JSON.stringify(comparableRules(lookup.ruleset.rules ?? [])) ===
    JSON.stringify(comparableRules(nextRules))
  ) {
    return { ok: true, created: false, changed: false, error: null };
  }

  const update = await cloudflareRequest<CloudflareRuleset>(
    token,
    `/zones/${zoneId}/rulesets/${lookup.ruleset.id}`,
    {
      body: JSON.stringify({
        description:
          lookup.ruleset.description ?? "Atlas API origin identity headers",
        kind: lookup.ruleset.kind,
        name: lookup.ruleset.name,
        phase: lookup.ruleset.phase,
        rules: nextRules,
      }),
      method: "PUT",
    },
  );
  return {
    ok: update.ok,
    created: false,
    changed: update.ok,
    error: update.error,
  };
}

async function getRateLimitRuleset(
  token: string,
  zoneId: string,
): Promise<RulesetLookup> {
  const lookup = await cloudflareRequest<CloudflareRuleset>(
    token,
    `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`,
    { method: "GET" },
  );
  if (lookup.ok) {
    return { ok: true, ruleset: lookup.value, error: null };
  }
  if (lookup.status === 404) {
    return { ok: true, ruleset: null, error: null };
  }
  return { ok: false, ruleset: null, error: lookup.error };
}

async function getTransformRuleset(
  token: string,
  zoneId: string,
): Promise<RulesetLookup> {
  const lookup = await cloudflareRequest<CloudflareRuleset>(
    token,
    `/zones/${zoneId}/rulesets/phases/http_request_late_transform/entrypoint`,
    { method: "GET" },
  );
  if (lookup.ok) {
    return { ok: true, ruleset: lookup.value, error: null };
  }
  if (lookup.status === 404) {
    return { ok: true, ruleset: null, error: null };
  }
  return { ok: false, ruleset: null, error: lookup.error };
}

function buildRateLimitRules(domain: string): CloudflareRateLimitRule[] {
  const protectedPaths =
    '(starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/mcp") or http.request.uri.path eq "/openapi.json" or http.request.uri.path eq "/docs")';
  const noCredentials =
    '(len(http.request.headers["authorization"]) eq 0 and len(http.request.headers["x-api-key"]) eq 0)';
  const credentialsPresent =
    '(len(http.request.headers["authorization"]) gt 0 or len(http.request.headers["x-api-key"]) gt 0)';
  const methodIsRead =
    '(http.request.method eq "GET" or http.request.method eq "HEAD")';
  const methodIsWrite =
    '(http.request.method ne "GET" and http.request.method ne "HEAD" and http.request.method ne "OPTIONS")';
  const methodIsCounted = '(http.request.method ne "OPTIONS")';
  const baseExpression = `http.host eq "${domain}" and ${protectedPaths}`;

  return [
    rateLimitRule({
      description: "Atlas anonymous API reads",
      expression: `(${baseExpression} and ${methodIsRead} and ${noCredentials})`,
      mitigationTimeout: 60,
      period: 60,
      requestsPerPeriod: 30,
    }),
    rateLimitRule({
      description: "Atlas anonymous API writes",
      expression: `(${baseExpression} and ${methodIsWrite} and ${noCredentials})`,
      mitigationTimeout: 60,
      period: 60,
      requestsPerPeriod: 10,
    }),
    rateLimitRule({
      description: "Atlas anonymous sustained API traffic",
      expression: `(${baseExpression} and ${methodIsCounted} and ${noCredentials})`,
      mitigationTimeout: 300,
      period: 3600,
      requestsPerPeriod: 120,
    }),
    rateLimitRule({
      description: "Atlas credentialed API pre-auth traffic",
      expression: `(${baseExpression} and ${methodIsCounted} and ${credentialsPresent})`,
      mitigationTimeout: 60,
      period: 60,
      requestsPerPeriod: 60,
    }),
    rateLimitRule({
      description: "Atlas credentialed sustained API pre-auth traffic",
      expression: `(${baseExpression} and ${methodIsCounted} and ${credentialsPresent})`,
      mitigationTimeout: 300,
      period: 3600,
      requestsPerPeriod: 600,
    }),
    rateLimitRule({
      description: "Atlas API origin abuse backstop",
      expression: `(${baseExpression} and ${methodIsCounted})`,
      mitigationTimeout: 60,
      period: 60,
      requestsPerPeriod: 300,
    }),
  ];
}

function rateLimitRule(input: {
  description: string;
  expression: string;
  mitigationTimeout: number;
  period: number;
  requestsPerPeriod: number;
}): CloudflareRateLimitRule {
  return {
    action: "block",
    action_parameters: {
      response: {
        content: JSON.stringify({ detail: "Too many requests." }),
        content_type: "application/json",
        status_code: 429,
      },
    },
    description: input.description,
    enabled: true,
    expression: input.expression,
    ratelimit: {
      characteristics: ["cf.colo.id", "ip.src"],
      mitigation_timeout: input.mitigationTimeout,
      period: input.period,
      requests_per_period: input.requestsPerPeriod,
      requests_to_origin: true,
    },
    ref: input.description.toLowerCase().replaceAll(" ", "-"),
  };
}

function buildTransformRules(config: ApiEdgeConfig): CloudflareRateLimitRule[] {
  return [
    {
      action: "rewrite",
      action_parameters: {
        headers: {
          "X-Atlas-Client-IP": {
            expression: "to_string(ip.src)",
            operation: "set",
          },
          "X-Atlas-Proxy-Secret": {
            operation: "set",
            value: config.edgeOriginSecret,
          },
        },
      },
      description: "Atlas API origin identity headers",
      enabled: true,
      expression: `http.host eq "${config.domain}"`,
      ref: "atlas-api-origin-identity-headers",
    },
  ];
}

function comparableRules(
  rules: CloudflareRateLimitRule[],
): CloudflareRateLimitRule[] {
  return rules.map((rule) => ({
    action: rule.action,
    action_parameters: rule.action_parameters,
    description: rule.description,
    enabled: rule.enabled,
    expression: rule.expression,
    ratelimit: rule.ratelimit,
    ref: rule.ref,
  }));
}

function stripCloudflareReadOnlyFields(
  rule: CloudflareRateLimitRule,
): CloudflareRateLimitRule {
  const {
    id: _id,
    last_updated: _lastUpdated,
    version: _version,
    ...updatable
  } = rule;
  return updatable;
}

async function cloudflareRequest<T>(
  token: string,
  route: string,
  init: RequestInit,
): Promise<CloudflareApiResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${CLOUDFLARE_API}${route}`, {
      ...init,
      headers,
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let envelope: CloudflareEnvelope<T>;
  try {
    envelope = (await response.json()) as CloudflareEnvelope<T>;
  } catch {
    return {
      ok: false,
      status: response.status,
      value: null,
      error: `Cloudflare returned non-JSON HTTP ${response.status}`,
    };
  }

  if (!response.ok || !envelope.success || envelope.result === undefined) {
    return {
      ok: false,
      status: response.status,
      value: null,
      error:
        envelope.errors?.map((err) => err.message).join("; ") ||
        `Cloudflare API HTTP ${response.status}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    value: envelope.result,
    error: null,
  };
}

function preflightCanonicalDomain(config: ApiEdgeConfig): HealthProbe {
  const record = runCommand(
    `gcloud beta run domain-mappings describe --domain="${config.domain}" --region="${config.region}" --project="${config.project}" --format="value(status.conditions[0].status)" 2>/dev/null`,
  );
  if (!record.ok || record.stdout.trim() !== "True") {
    return {
      healthy: false,
      output: commandOutput(record),
      statusCode: null,
      viaCloudflare: false,
    };
  }
  const probe = runHealthProbe(config.domain);
  return probe;
}

async function waitForCloudflareHealth(
  domain: string,
  attempts = 12,
): Promise<HealthProbe> {
  const s = spinner();
  s.start(`Waiting for Cloudflare proxy on ${domain}...`);
  let lastProbe: HealthProbe = {
    healthy: false,
    output: "",
    statusCode: null,
    viaCloudflare: false,
  };
  for (let attempt = 0; attempt < attempts; attempt++) {
    lastProbe = runHealthProbe(domain);
    if (lastProbe.healthy && lastProbe.viaCloudflare) {
      s.stop(`https://${domain}/health responding through Cloudflare`);
      return lastProbe;
    }
    await sleep(5000);
  }
  s.stop("Cloudflare proxy did not respond as expected");
  return lastProbe;
}

function runHealthProbe(domain: string): HealthProbe {
  const result = runCommand(`curl -sI --max-time 10 https://${domain}/health`);
  const output = commandOutput(result);
  const statusCode = statusCodeFromHeaders(output);
  return {
    healthy:
      result.ok && statusCode !== null && statusCode >= 200 && statusCode < 300,
    output,
    statusCode,
    viaCloudflare:
      /(?:^|\n)cf-ray:/i.test(output) ||
      /(?:^|\n)server:\s*cloudflare/i.test(output),
  };
}

async function reportStatus(
  token: string,
  zoneId: string,
  config: ApiEdgeConfig,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  const record = findCnameRecord(token, zoneId, config.domain);
  logSubline(
    `Cloudflare proxy for ${config.domain}: ${
      record?.proxied ? pc.green("enabled") : pc.yellow("not enabled")
    }`,
  );
  if (!record?.proxied) {
    followUpItems.push(
      `Run \`pnpm bootstrap --api-edge${
        config.target === "staging" ? " --target staging" : ""
      }\` to enable Cloudflare proxying and rate-limit rules.`,
    );
  }

  const rules = await getRateLimitRuleset(token, zoneId);
  const existingRateLimitDescriptions = new Set(
    (rules.ruleset?.rules ?? []).map((rule) => rule.description),
  );
  const hasAllRateLimitRules = [...EDGE_RATE_LIMIT_RULE_DESCRIPTIONS].every(
    (description) => existingRateLimitDescriptions.has(description),
  );
  logSubline(
    `Cloudflare rate-limit rules: ${
      hasAllRateLimitRules ? pc.green("installed") : pc.yellow("missing")
    }`,
  );
  if (!rules.ok || !hasAllRateLimitRules) {
    followUpItems.push(
      `Run \`pnpm bootstrap --api-edge${
        config.target === "staging" ? " --target staging" : ""
      }\` to install Atlas API edge rate limits.`,
    );
  }

  const transforms = await getTransformRuleset(token, zoneId);
  const existingTransformDescriptions = new Set(
    (transforms.ruleset?.rules ?? []).map((rule) => rule.description),
  );
  const hasAllTransformRules = [...EDGE_TRANSFORM_RULE_DESCRIPTIONS].every(
    (description) => existingTransformDescriptions.has(description),
  );
  logSubline(
    `Cloudflare origin identity headers: ${
      hasAllTransformRules ? pc.green("installed") : pc.yellow("missing")
    }`,
  );
  if (!transforms.ok || !hasAllTransformRules) {
    followUpItems.push(
      `Run \`pnpm bootstrap --api-edge${
        config.target === "staging" ? " --target staging" : ""
      }\` to install Atlas API origin identity headers.`,
    );
  }

  const probe = runHealthProbe(config.domain);
  logSubline(
    `Cloudflare health probe: ${
      probe.healthy && probe.viaCloudflare
        ? pc.green(`HTTP ${probe.statusCode}`)
        : pc.yellow(`HTTP ${probe.statusCode ?? "none"}`)
    }`,
  );

  return {
    success:
      Boolean(record?.proxied) &&
      rules.ok &&
      hasAllRateLimitRules &&
      transforms.ok &&
      hasAllTransformRules &&
      probe.healthy &&
      probe.viaCloudflare,
    followUpItems,
  };
}

function statusCodeFromHeaders(headers: string): number | null {
  const match = /^HTTP\/[12](?:\.[01])?\s+(\d{3})/im.exec(headers);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function readConfig(
  projectRoot: string,
  target: ApiDomainTarget,
): ApiEdgeConfig | null {
  const env = mergeEnvFiles([
    path.join(projectRoot, ".env.production"),
    path.join(projectRoot, ".env"),
    path.join(projectRoot, "api", ".env"),
  ]);
  const project = env.get("GCP_PROJECT_ID");
  if (!project) return null;
  const targetConfig = TARGETS[target];
  return {
    target,
    domain: targetConfig.domain,
    service: targetConfig.service,
    region: env.get("GCP_REGION") ?? DEFAULT_REGION,
    project,
    edgeOriginSecret: env.get("ATLAS_EDGE_ORIGIN_SECRET") ?? "",
  };
}

function mergeEnvFiles(files: string[]): Map<string, string> {
  const merged = new Map<string, string>();
  for (const file of files) {
    if (!existsSync(file)) continue;
    const parsed = parseEnvFile(file);
    for (const [key, value] of parsed) {
      if (!merged.has(key)) merged.set(key, value);
    }
  }
  return merged;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
