import { spinner } from "@clack/prompts";
import pc from "picocolors";
import { commandOutput, runCommand } from "../lib/shell.js";
import { logSubline } from "../lib/ui.js";
import { findCnameRecord } from "../lib/cloudflare.js";
import type { PhaseResult } from "../state.js";
import type { ApiEdgeConfig } from "./api-edge-models.js";
import type { HealthProbe } from "./api-edge-models.js";
import {
  EDGE_RATE_LIMIT_RULE_DESCRIPTIONS,
  EDGE_TRANSFORM_RULE_DESCRIPTIONS,
} from "./api-edge-rules.js";
import {
  getRateLimitRuleset,
  getTransformRuleset,
} from "./api-edge-cloudflare.js";

export function preflightCanonicalDomain(config: ApiEdgeConfig): HealthProbe {
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
  return runHealthProbe(config.domain);
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
