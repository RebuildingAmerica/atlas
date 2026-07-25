import { spinner } from "@clack/prompts";
import pc from "picocolors";
import { commandOutput, runCommand, type CommandResult } from "../lib/shell.js";
import { logSubline } from "../lib/ui.js";
import { findCnameRecord } from "../lib/cloudflare.js";
import type { PhaseResult } from "../state.js";
import type {
  ApiEdgeConfig,
  DomainMappingPayload,
  DomainMappingReadiness,
  HealthProbe,
} from "./api-edge-models.js";
import {
  EDGE_RATE_LIMIT_RULE_DESCRIPTIONS,
  EDGE_TRANSFORM_RULE_DESCRIPTIONS,
} from "./api-edge-rules.js";
import {
  getRateLimitRuleset,
  getTransformRuleset,
} from "./api-edge-cloudflare.js";

/**
 * Confirm the canonical API domain is serving before edge proxying is enabled.
 *
 * A 200 over https://<domain>/health is the authoritative signal: it can only
 * happen once the Cloud Run domain mapping and its certificate are live, and
 * the CNAME this phase manages points at Cloud Run. The domain mapping is
 * queried only to explain a failing probe, never to veto a passing one -- an
 * unreadable mapping used to block edge setup on a demonstrably healthy API.
 *
 * Parameters
 * ----------
 * config
 *     Resolved edge configuration for the target environment.
 *
 * Returns
 * -------
 * HealthProbe
 *     The HTTPS probe, with domain mapping detail appended when it failed.
 */
export function preflightCanonicalDomain(config: ApiEdgeConfig): HealthProbe {
  const probe = runHealthProbe(config.domain);
  if (probe.healthy) {
    return probe;
  }

  const mapping = describeDomainMappingReadiness(config);
  return {
    ...probe,
    output: [probe.output, mapping.detail].join("\n\n"),
  };
}

/**
 * Read the Ready condition of the Cloud Run domain mapping for the API domain.
 *
 * Parameters
 * ----------
 * config
 *     Resolved edge configuration for the target environment.
 *
 * Returns
 * -------
 * DomainMappingReadiness
 *     Whether gcloud answered, whether the mapping is Ready, and why not.
 */
export function describeDomainMappingReadiness(
  config: ApiEdgeConfig,
): DomainMappingReadiness {
  return parseDomainMappingReadiness(
    runCommand(
      `gcloud beta run domain-mappings describe --domain="${config.domain}" --region="${config.region}" --project="${config.project}" --format=json`,
    ),
  );
}

/**
 * Turn a `gcloud run domain-mappings describe` result into readiness detail.
 *
 * stderr is deliberately preserved rather than discarded: a stale gcloud login
 * and a genuinely unready mapping are different problems, and collapsing both
 * into an empty string leaves the operator with nothing to act on.
 *
 * Parameters
 * ----------
 * result
 *     Captured result of the describe command.
 *
 * Returns
 * -------
 * DomainMappingReadiness
 *     Parsed readiness, or the reason the lookup could not answer.
 */
export function parseDomainMappingReadiness(
  result: CommandResult,
): DomainMappingReadiness {
  if (!result.ok) {
    return {
      queried: false,
      ready: false,
      detail: `Cloud Run domain mapping lookup failed:\n${commandOutput(result)}`,
    };
  }

  const payload = parseDomainMappingPayload(result.stdout);
  if (!payload.readable) {
    return {
      queried: false,
      ready: false,
      detail: `Cloud Run domain mapping lookup returned unreadable output:\n${commandOutput(result)}`,
    };
  }

  const ready = payload.ready;
  if (!ready) {
    return {
      queried: true,
      ready: false,
      detail:
        "Cloud Run domain mapping exists but has not reported a Ready condition yet.",
    };
  }
  if (ready.status === "True") {
    return {
      queried: true,
      ready: true,
      detail:
        "Cloud Run domain mapping is Ready, so the failure is downstream of DNS and certificates.",
    };
  }

  const cause = [ready.reason, ready.message]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(": ");
  return {
    queried: true,
    ready: false,
    detail: `Cloud Run domain mapping is not Ready (status ${ready.status ?? "unset"})${
      cause ? `: ${cause}` : ""
    }`,
  };
}

function parseDomainMappingPayload(stdout: string): DomainMappingPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { readable: false, ready: null };
  }
  if (!isRecord(parsed)) {
    return { readable: false, ready: null };
  }

  const status = parsed.status;
  if (!isRecord(status)) {
    return { readable: true, ready: null };
  }
  const conditions = status.conditions;
  if (!Array.isArray(conditions)) {
    return { readable: true, ready: null };
  }

  const ready = conditions
    .filter(isRecord)
    .find((condition) => condition.type === "Ready");
  if (!ready) {
    return { readable: true, ready: null };
  }
  return {
    readable: true,
    ready: {
      type: readString(ready.type),
      status: readString(ready.status),
      message: readString(ready.message),
      reason: readString(ready.reason),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function waitForCloudflareHealth(
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

export async function reportStatus(
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

export function runHealthProbe(domain: string): HealthProbe {
  const result = runCommand(
    `curl -sS --max-time 10 -D - -o /dev/null https://${domain}/health`,
  );
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

function statusCodeFromHeaders(headers: string): number | null {
  const match = /^HTTP\/[12](?:\.[01])?\s+(\d{3})/im.exec(headers);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
