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

const CLOUD_RUN_CNAME_TARGET = "ghs.googlehosted.com";
const DEFAULT_REGION = "us-central1";
const DEFAULT_DOMAIN = "atlas-api.rebuildingus.org";
const DEFAULT_SERVICE = "atlas-api";

interface ApiDomainConfig {
  domain: string;
  service: string;
  region: string;
  project: string;
}

export async function runApiDomainPhase(
  projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];

  if (!runCommand("command -v gcloud").ok) {
    log.warn("gcloud CLI not installed — install it and re-run.");
    followUpItems.push(
      "Install gcloud CLI to manage Cloud Run domain mappings",
    );
    return { success: false, followUpItems };
  }

  const config = readConfig(projectRoot);
  if (!config) {
    log.error("Could not determine GCP project (set GCP_PROJECT_ID in .env).");
    followUpItems.push(
      "Set GCP_PROJECT_ID in .env / .env.production before running --api-domain",
    );
    return { success: false, followUpItems };
  }

  const mappingResult = ensureCloudRunMapping(config, doctorMode);
  if (!mappingResult.ok) {
    followUpItems.push(...mappingResult.followUpItems);
    if (doctorMode) {
      return { success: false, followUpItems };
    }
    return { success: false, followUpItems };
  }

  if (doctorMode) {
    return reportStatus(config);
  }

  const proceed = await promptConfirm(
    `Ensure Cloudflare CNAME ${pc.cyan(config.domain)} → ${pc.dim(CLOUD_RUN_CNAME_TARGET)}?`,
    true,
  );
  if (!proceed) {
    followUpItems.push(
      `Add CNAME ${config.domain} → ${CLOUD_RUN_CNAME_TARGET} in Cloudflare (DNS-only).`,
    );
    return { success: true, followUpItems };
  }

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
    return { success: false, followUpItems };
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
    return { success: false, followUpItems };
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

  await waitForCertReadiness(config, followUpItems);

  log.success(
    `Canonical API domain ready: ${pc.cyan(`https://${config.domain}`)}`,
  );
  logSubline(
    pc.dim(
      `Vercel still proxies via ATLAS_SERVER_API_PROXY_TARGET — point it at this domain to retire the *.run.app URL.`,
    ),
  );

  return { success: true, followUpItems };
}

// ── Cloud Run mapping ────────────────────────────────────────────────────────

interface MappingResult {
  ok: boolean;
  followUpItems: string[];
}

function ensureCloudRunMapping(
  config: ApiDomainConfig,
  doctorMode: boolean,
): MappingResult {
  const describe = runCommand(
    `gcloud beta run domain-mappings describe --domain="${config.domain}" --region="${config.region}" --project="${config.project}" --format=json 2>/dev/null`,
  );
  if (describe.ok) {
    logSubline(
      `Cloud Run mapping ${pc.cyan(config.domain)} → ${pc.dim(config.service)} already exists`,
    );
    return { ok: true, followUpItems: [] };
  }

  if (doctorMode) {
    return {
      ok: false,
      followUpItems: [
        `Create Cloud Run domain mapping: gcloud beta run domain-mappings create --service=${config.service} --domain=${config.domain} --region=${config.region}`,
      ],
    };
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

// ── Cert + DNS readiness ─────────────────────────────────────────────────────

async function waitForCertReadiness(
  config: ApiDomainConfig,
  followUpItems: string[],
): Promise<void> {
  const s = spinner();
  s.start("Waiting for Cloud Run cert + DNS to be ready...");
  for (let attempt = 0; attempt < 18; attempt++) {
    const verify = verifyCname(config.domain, CLOUD_RUN_CNAME_TARGET);
    if (verify.resolved) {
      const probe = runCommand(
        `curl -sI --max-time 5 https://${config.domain}/health`,
      );
      if (probe.ok && /^HTTP\/[12](\.[01])? 2\d\d/m.test(probe.stdout)) {
        s.stop(`https://${config.domain}/health responding`);
        return;
      }
    }
    await sleep(10000);
  }
  s.stop("Cert + DNS not yet healthy (continuing)");
  followUpItems.push(
    `Cert provisioning still in progress for ${config.domain}; re-run --api-domain in a few minutes to verify.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      "Run `pnpm bootstrap --api-domain` to provision the Cloudflare CNAME",
    );
  }
  return {
    success: verify.resolved,
    followUpItems,
  };
}

// ── Config reader ────────────────────────────────────────────────────────────

function readConfig(projectRoot: string): ApiDomainConfig | null {
  const env = mergeEnvFiles([
    path.join(projectRoot, ".env.production"),
    path.join(projectRoot, ".env"),
    path.join(projectRoot, "api", ".env"),
  ]);
  const project = env.get("GCP_PROJECT_ID");
  if (!project) return null;
  return {
    domain: env.get("ATLAS_API_DOMAIN") ?? DEFAULT_DOMAIN,
    service: env.get("ATLAS_API_SERVICE_NAME") ?? DEFAULT_SERVICE,
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
