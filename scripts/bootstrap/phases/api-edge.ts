import { log } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../state.js";
import { promptConfirm, logSubline } from "../lib/ui.js";
import {
  enableCloudflareProxy,
  ensureRateLimitRules,
  ensureTransformRules,
  prepareCloudflareToken,
  resolveZoneId,
} from "./api-edge-cloudflare.js";
import { persistCloudflareToken } from "../lib/cloudflare.js";
import { readConfig } from "./api-edge-config.js";
import {
  preflightCanonicalDomain,
  reportStatus,
  waitForCloudflareHealth,
} from "./api-edge-health.js";
import type { ApiDomainTarget } from "./api-domain.js";

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

  const acquired = await prepareCloudflareToken(config.domain);
  const zoneId = resolveZoneId(acquired.token, config.domain);
  if (!zoneId) {
    log.error(
      `Could not find Cloudflare zone for ${config.domain}. Is the API token scoped to ${config.domain}'s parent zone?`,
    );
    followUpItems.push(
      `Verify the Cloudflare Account API token is scoped to ${config.domain}'s parent zone with DNS & Zones > DNS > Edit, DNS & Zones > Zone > Read, App Security > Zone WAF Rules > Edit, and Rules & Configuration > Zone Transform Rules > Edit`,
    );
    return { success: false, followUpItems };
  }

  if (doctorMode) {
    return await reportStatus(acquired.token, zoneId, config);
  }

  const proceed = await promptConfirm(
    [
      `Enable Cloudflare edge protection for ${config.domain}?`,
      "",
      "Bootstrap will turn on the Cloudflare proxy, add anonymous API rate-limit rules, and add origin identity headers.",
      "Choose Yes only after the canonical API domain is healthy.",
      "Choose No to leave DNS and WAF rules unchanged for now.",
    ].join("\n"),
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
      [
        "Save Cloudflare token for future API edge setup?",
        "",
        "Bootstrap will write it to ~/.config/atlas-bootstrap/cloudflare-token with chmod 600.",
        "Choose Yes if this machine should manage Atlas DNS and WAF rules again later.",
        "Choose No if this was a one-time token.",
      ].join("\n"),
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
