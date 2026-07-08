import { log, spinner } from "@clack/prompts";
import pc from "picocolors";
import {
  acquireCloudflareToken,
  type AcquiredCloudflareToken,
  getZoneId,
  parentZone,
  upsertCname,
} from "../lib/cloudflare.js";
import type {
  ApiEdgeConfig,
  CloudflareApiResult,
  CloudflareRuleset,
  EdgeRuleResult,
  RulesetLookup,
} from "./api-edge-models.js";
import {
  buildRateLimitRules,
  buildTransformRules,
  comparableRules,
  stripCloudflareReadOnlyFields,
} from "./api-edge-rules.js";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const CLOUD_RUN_CNAME_TARGET = "ghs.googlehosted.com";

export async function prepareCloudflareToken(
  domain: string,
): Promise<AcquiredCloudflareToken> {
  return acquireCloudflareToken({
    permissionsHint:
      'with Zone DNS Edit, Zone WAF Edit, Transform Rules Edit, and Rulesets Read permissions for the "rebuildingus.org" zone',
    zoneHint: parentZone(domain),
  });
}

export function resolveZoneId(token: string, domain: string): string | null {
  return getZoneId(token, domain);
}

export function enableCloudflareProxy(
  token: string,
  zoneId: string,
  config: ApiEdgeConfig,
  followUpItems: string[],
): boolean {
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

export async function ensureRateLimitRules(
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
    .filter((rule) => !rule.description.includes("Atlas"))
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

export async function ensureTransformRules(
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
    .filter((rule) => !rule.description.includes("Atlas"))
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

export async function getRateLimitRuleset(
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

export async function getTransformRuleset(
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

export async function cloudflareRequest<T>(
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

  let envelope: {
    success: boolean;
    result?: T;
    errors?: { message: string }[];
  };
  try {
    envelope = (await response.json()) as {
      success: boolean;
      result?: T;
      errors?: { message: string }[];
    };
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
