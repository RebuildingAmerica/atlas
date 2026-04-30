import path from "node:path";
import { existsSync } from "node:fs";
import { log, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../lib/types.js";
import { commandOutput, runCommand } from "../lib/shell.js";
import { logSubline, promptConfirm } from "../lib/ui.js";
import { parseEnvFile } from "../lib/env-file.js";
import {
  acquireCloudflareToken,
  getZoneId,
  parentZone,
  persistCloudflareToken,
  upsertCname,
  verifyCname,
} from "../lib/cloudflare.js";

export type ApiDomainTarget = "prod" | "staging";

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

interface ApiDomainConfig {
  target: ApiDomainTarget;
  domain: string;
  service: string;
  region: string;
  project: string;
}

export async function runApiDomainPhase(
  projectRoot: string,
  doctorMode: boolean,
  target: ApiDomainTarget = "prod",
): Promise<PhaseResult> {
  const followUpItems: string[] = [];

  if (!runCommand("command -v gcloud").ok) {
    log.warn("gcloud CLI not installed — install it and re-run.");
    followUpItems.push(
      "Install gcloud CLI to manage Cloud Run domain mappings",
    );
    return { success: false, followUpItems };
  }

  const config = readConfig(projectRoot, target);
  if (!config) {
    log.error("Could not determine GCP project (set GCP_PROJECT_ID in .env).");
    followUpItems.push(
      "Set GCP_PROJECT_ID in .env / .env.production before running --api-domain",
    );
    return { success: false, followUpItems };
  }

  log.step(
    `Configuring canonical domain for ${pc.cyan(config.service)} (${target})`,
  );

  if (!cloudRunServiceExists(config)) {
    log.error(
      `Cloud Run service ${config.service} not found in ${config.region} (${config.project}).`,
    );
    if (target === "staging") {
      followUpItems.push(
        `Provision the staging service first: gcloud run deploy ${config.service} --image=<atlas-api image tag> --region=${config.region} --allow-unauthenticated --port=8000`,
      );
    } else {
      followUpItems.push(
        `Provision the production service first: pnpm bootstrap (deploy phase)`,
      );
    }
    return { success: false, followUpItems };
  }

  if (doctorMode) {
    return reportStatus(config);
  }

  const proceed = await promptConfirm(
    `Ensure canonical domain ${pc.cyan(config.domain)} → ${pc.dim(config.service)}?`,
    true,
  );
  if (!proceed) {
    followUpItems.push(
      `Add CNAME ${config.domain} → ${CLOUD_RUN_CNAME_TARGET} in Cloudflare and Cloud Run mapping for ${config.service}.`,
    );
    return { success: true, followUpItems };
  }

  // 1. Cloudflare CNAME first — Cloud Run cert challenge succeeds only when
  //    DNS already resolves. Mapping-then-DNS triggers a 1-hour retry hold.
  const dnsResult = await ensureCloudflareCname(config, followUpItems);
  if (!dnsResult.ok) {
    return { success: false, followUpItems };
  }

  await waitForDns(config.domain);

  // 2. Cloud Run mapping. Cert challenge runs as soon as the mapping is
  //    created; with DNS already in place it should succeed immediately.
  const mappingResult = ensureCloudRunMapping(config);
  if (!mappingResult.ok) {
    followUpItems.push(...mappingResult.followUpItems);
    return { success: false, followUpItems };
  }

  await waitForCertReadiness(config, followUpItems);

  log.success(
    `Canonical ${target} API domain ready: ${pc.cyan(`https://${config.domain}`)}`,
  );
  if (target === "prod") {
    logSubline(
      pc.dim(
        `Set Vercel ATLAS_SERVER_API_PROXY_TARGET=https://${config.domain} to retire the *.run.app URL.`,
      ),
    );
  }

  return { success: true, followUpItems };
}

// ── Cloudflare CNAME ─────────────────────────────────────────────────────────

interface DnsResult {
  ok: boolean;
}

async function ensureCloudflareCname(
  config: ApiDomainConfig,
  followUpItems: string[],
): Promise<DnsResult> {
  const acquired = await acquireCloudflareToken({
    zoneHint: parentZone(config.domain),
  });

  const zoneId = getZoneId(acquired.token, config.domain);
  if (!zoneId) {
    log.error(
      `Could not find Cloudflare zone for ${parentZone(config.domain)}. Is the API token scoped to that zone?`,
    );
    followUpItems.push(
      `Verify the Cloudflare API token has DNS edit access to ${parentZone(config.domain)}`,
    );
    return { ok: false };
  }

  const dnsSpinner = spinner();
  dnsSpinner.start(
    `Upserting CNAME ${config.domain} → ${CLOUD_RUN_CNAME_TARGET}...`,
  );
  const upsert = upsertCname(
    acquired.token,
    zoneId,
    config.domain,
    CLOUD_RUN_CNAME_TARGET,
    {
      proxied: false,
      comment: `Cloud Run mapping for ${config.service}`,
    },
  );
  if (!upsert.ok) {
    dnsSpinner.stop("Failed to upsert CNAME");
    log.error(upsert.error ?? "Cloudflare API call failed");
    followUpItems.push(
      `Add CNAME ${config.domain} → ${CLOUD_RUN_CNAME_TARGET} via Cloudflare dashboard`,
    );
    return { ok: false };
  }
  dnsSpinner.stop(
    upsert.created
      ? `Cloudflare CNAME created (${pc.dim(upsert.recordId ?? "?")})`
      : `Cloudflare CNAME already correct (${pc.dim(upsert.recordId ?? "?")})`,
  );

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
        "Cloudflare token not saved; --api-domain will re-prompt next run.",
      );
    }
  }

  return { ok: true };
}

async function waitForDns(name: string, attempts = 10): Promise<void> {
  const s = spinner();
  s.start(`Waiting for DNS propagation of ${name}...`);
  for (let i = 0; i < attempts; i++) {
    const verify = verifyCname(name, CLOUD_RUN_CNAME_TARGET);
    if (verify.resolved) {
      s.stop(`DNS resolved: ${name} → ${verify.observed}`);
      return;
    }
    await sleep(5000);
  }
  s.stop("DNS not resolving on 1.1.1.1 yet — will continue, may slow cert");
}

// ── Cloud Run service / mapping ──────────────────────────────────────────────

function cloudRunServiceExists(config: ApiDomainConfig): boolean {
  const result = runCommand(
    `gcloud run services describe "${config.service}" --region="${config.region}" --project="${config.project}" --format="value(metadata.name)" 2>/dev/null`,
  );
  return result.ok && result.stdout.trim() === config.service;
}

interface MappingResult {
  ok: boolean;
  followUpItems: string[];
}

function ensureCloudRunMapping(config: ApiDomainConfig): MappingResult {
  const describe = runCommand(
    `gcloud beta run domain-mappings describe --domain="${config.domain}" --region="${config.region}" --project="${config.project}" --format=json 2>/dev/null`,
  );
  if (describe.ok) {
    logSubline(
      `Cloud Run mapping ${pc.cyan(config.domain)} → ${pc.dim(config.service)} already exists`,
    );
    return { ok: true, followUpItems: [] };
  }

  const s = spinner();
  s.start(`Creating Cloud Run mapping for ${config.domain}...`);
  const create = runCommand(
    `gcloud beta run domain-mappings create ` +
      `--service="${config.service}" ` +
      `--domain="${config.domain}" ` +
      `--region="${config.region}" ` +
      `--project="${config.project}" ` +
      `--quiet 2>&1`,
  );
  if (!create.ok) {
    s.stop("Cloud Run mapping creation failed");
    log.error(commandOutput(create));
    return {
      ok: false,
      followUpItems: [
        `Create Cloud Run domain mapping: gcloud beta run domain-mappings create --service=${config.service} --domain=${config.domain} --region=${config.region}`,
      ],
    };
  }
  s.stop(`Cloud Run mapping created for ${config.domain}`);
  return { ok: true, followUpItems: [] };
}

async function waitForCertReadiness(
  config: ApiDomainConfig,
  followUpItems: string[],
): Promise<void> {
  const s = spinner();
  s.start("Waiting for Cloud Run cert + HTTPS to be live...");
  for (let attempt = 0; attempt < 18; attempt++) {
    const probe = runCommand(
      `curl -sI --max-time 5 https://${config.domain}/health`,
    );
    if (probe.ok && /^HTTP\/[12](\.[01])? 2\d\d/m.test(probe.stdout)) {
      s.stop(`https://${config.domain}/health responding`);
      return;
    }
    await sleep(10000);
  }
  s.stop("Cert + HTTPS not yet live (continuing)");
  followUpItems.push(
    `Cert provisioning still in progress for ${config.domain}; re-run --api-domain in a few minutes to verify.`,
  );
}

// ── Doctor / status ──────────────────────────────────────────────────────────

function reportStatus(config: ApiDomainConfig): PhaseResult {
  const verify = verifyCname(config.domain, CLOUD_RUN_CNAME_TARGET);
  const followUpItems: string[] = [];
  logSubline(
    `Cloudflare CNAME for ${config.domain}: ${
      verify.resolved
        ? pc.green(`→ ${verify.observed}`)
        : pc.yellow(`observed: ${verify.observed ?? "no record"}`)
    }`,
  );
  if (!verify.resolved) {
    followUpItems.push(
      `Run \`pnpm bootstrap --api-domain${
        config.target === "staging" ? " --target staging" : ""
      }\` to provision the Cloudflare CNAME`,
    );
  }
  return {
    success: verify.resolved,
    followUpItems,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readConfig(
  projectRoot: string,
  target: ApiDomainTarget,
): ApiDomainConfig | null {
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
  };
}

function mergeEnvFiles(files: string[]): Map<string, string> {
  const merged = new Map<string, string>();
  for (const file of files) {
    if (!existsSync(file)) continue;
    const parsed = parseEnvFile(file);
    for (const [k, v] of parsed) {
      if (!merged.has(k)) merged.set(k, v);
    }
  }
  return merged;
}
