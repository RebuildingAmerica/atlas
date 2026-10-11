/**
 * `pnpm bootstrap --access-gate`: puts Cloudflare Access, signed in through
 * Google Workspace, in front of the platform admin host.
 *
 * Reads the account's Access state with the pinned `cf` CLI, plans the
 * difference (access-gate-plan.ts), applies it unless `--doctor` was given,
 * and stores the team domain and audience tag the admin app verifies.
 * Running it again changes nothing once the account matches.
 *
 * Zero Trust itself and the Google Workspace identity provider are one-time
 * dashboard steps it cannot do; it reports them and stops. The click-path is
 * in docs/runbooks/platform-admin-access.md.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { log } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../state.js";
import { CfCommandError, createCfRunner, type CfRunner } from "../lib/cf.js";
import { acquireCloudflareToken } from "../lib/cloudflare.js";
import { mergeEnvFile, parseEnvFile } from "../lib/env-file.js";
import {
  hostedEnvFilePath,
  type HostedDeployTarget,
} from "../lib/hosted-target.js";
import {
  allowPolicyBody,
  appBody,
  planAccessGate,
  type AccessApp,
  type AccessGateConfig,
  type AccessPolicy,
  type AccessProvider,
  type GatePlan,
  type ObservedAccess,
} from "./access-gate-plan.js";

const APP_NAME = "Atlas platform admin";
/** Removal takes effect at the next sign-in, so the session bounds how long a removed person keeps access. */
const SESSION_DURATION = "8h";
const PAGE_SIZE = 100;
/** A guard against an endpoint that ignores the page number and repeats itself. */
const MAX_PAGES = 50;

export const ACCESS_TOKEN_PERMISSIONS = [
  "Access: Apps and Policies > Edit",
  "Access: Organizations, Identity Providers, and Groups > Read",
];

/** The values the admin app reads to verify Access assertions. */
export interface AccessGateOutputs {
  ATLAS_ACCESS_TEAM_DOMAIN: string;
  ATLAS_ACCESS_AUD: string;
}

export interface AccessGateResult {
  plan: GatePlan;
  outputs: AccessGateOutputs | null;
}

function required(env: Map<string, string>, key: string): string {
  const value = env.get(key)?.trim();
  if (!value) throw new Error(`${key} is required for the Access gate.`);
  return value;
}

/**
 * Reads the gate's settings from merged env files.
 *
 * @param env - Merged values from `.env.production`, `.env` and `admin/.env`.
 */
export function readAccessGateConfig(
  env: Map<string, string>,
  target: HostedDeployTarget,
): AccessGateConfig {
  const hostname = new URL(required(env, "ATLAS_ADMIN_PUBLIC_URL")).hostname;
  const expectedHostname =
    target === "production"
      ? "atlas-admin.rebuildingus.org"
      : "atlas-admin-staging.rebuildingus.org";
  if (hostname !== expectedHostname) {
    throw new Error(
      `ATLAS_ADMIN_PUBLIC_URL does not match the ${target} admin hostname.`,
    );
  }
  const operatorEmails = required(env, "ATLAS_PLATFORM_OPERATOR_EMAILS")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
  const emailDomain = required(env, "ATLAS_ACCESS_EMAIL_DOMAIN").toLowerCase();
  for (const email of operatorEmails) {
    if (!email.endsWith(`@${emailDomain}`)) {
      throw new Error(`${email} is not an @${emailDomain} address.`);
    }
  }
  return {
    appName: target === "production" ? APP_NAME : `${APP_NAME} staging`,
    emailDomain,
    hostname,
    operatorEmails,
    sessionDuration: SESSION_DURATION,
  };
}

/**
 * Reads every page of a list. It stops at the first empty page rather than at
 * a short one, because an endpoint may cap the page size below what was asked
 * for; stopping after the first page once duplicated applications in another
 * org's setup tooling.
 */
function listAll<T>(run: CfRunner, args: string[]): T[] {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = run([
      ...args,
      "--page",
      String(page),
      "--per-page",
      String(PAGE_SIZE),
    ]);
    const rows = Array.isArray(batch) ? (batch as T[]) : [];
    if (rows.length === 0) return items;
    items.push(...rows);
  }
  throw new Error(
    `cf ${args.join(" ")} returned more than ${String(MAX_PAGES)} pages.`,
  );
}

/**
 * Reads the account's Zero Trust organization, identity providers, Access
 * applications and reusable policies.
 *
 * @param run - Runs `cf` commands against the account.
 */
export function observeAccess(run: CfRunner): ObservedAccess {
  let teamDomain: string | null;
  try {
    const organization = run(["zero-trust", "organizations", "list"]) as {
      auth_domain?: string;
    };
    teamDomain = organization.auth_domain ?? null;
  } catch (error) {
    if (!(error instanceof CfCommandError)) throw error;
    teamDomain = null;
  }
  return {
    apps: listAll<AccessApp>(run, [
      "zero-trust",
      "access",
      "applications",
      "list",
    ]),
    policies: listAll<AccessPolicy>(run, [
      "zero-trust",
      "access",
      "policies",
      "list",
    ]),
    providers: listAll<AccessProvider>(run, [
      "zero-trust",
      "identity-providers",
      "list",
    ]),
    teamDomain,
  };
}

/**
 * Applies a plan in order: the allow policy first, then the application that
 * attaches it. Returns the application's audience tag.
 *
 * @param run - Runs `cf` commands against the account.
 * @param config - The gate Atlas wants.
 * @param plan - The changes to make.
 * @param observed - The account state the plan was made from.
 */
export function applyAccessGate(
  run: CfRunner,
  config: AccessGateConfig,
  plan: GatePlan,
  observed: ObservedAccess,
): string {
  let policyId = observed.policies.find(
    (policy) => policy.name === allowPolicyBody(config).name,
  )?.id;
  let app: AccessApp | undefined;
  for (const action of plan.actions) {
    switch (action.type) {
      case "create-policy":
        policyId = (
          run(
            ["zero-trust", "access", "policies", "create"],
            action.body,
          ) as AccessPolicy
        ).id;
        break;
      case "update-policy":
        run(
          ["zero-trust", "access", "policies", "update", action.id],
          action.body,
        );
        policyId = action.id;
        break;
      case "create-app":
        app = run(
          ["zero-trust", "access", "applications", "create"],
          appBody(config, action.providerId, requirePolicyId(policyId)),
        ) as AccessApp;
        break;
      case "update-app":
        app = run(
          ["zero-trust", "access", "applications", "update", action.found.id],
          appBody(config, action.providerId, requirePolicyId(policyId), {
            existingPolicies: action.found.policies ?? [],
            reusablePolicies: observed.policies,
          }),
        ) as AccessApp;
        break;
    }
  }
  const audience =
    app?.aud ??
    observed.apps.find(
      (candidate) =>
        candidate.name === config.appName ||
        candidate.domain === config.hostname,
    )?.aud;
  if (!audience)
    throw new Error(
      "Cloudflare did not return an audience tag for the Access application.",
    );
  return audience;
}

function requirePolicyId(policyId: string | undefined): string {
  if (!policyId) throw new Error("The Access allow policy was not created.");
  return policyId;
}

/**
 * Observes, plans and (unless in doctor mode) applies the gate.
 *
 * @param run - Runs `cf` commands against the account.
 * @param config - The gate Atlas wants.
 * @param options - `doctor: true` reports without changing anything.
 */
export function reconcileAccessGate(
  run: CfRunner,
  config: AccessGateConfig,
  options: { doctor?: boolean } = {},
): AccessGateResult {
  const observed = observeAccess(run);
  const plan = planAccessGate(config, observed);
  if (plan.blocked || options.doctor || !observed.teamDomain)
    return { outputs: null, plan };
  const audience = applyAccessGate(run, config, plan, observed);
  return {
    outputs: {
      ATLAS_ACCESS_AUD: audience,
      ATLAS_ACCESS_TEAM_DOMAIN: observed.teamDomain,
    },
    plan,
  };
}

function mergedEnv(files: string[]): Map<string, string> {
  const merged = new Map<string, string>();
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const [key, value] of parseEnvFile(file)) {
      if (!merged.has(key)) merged.set(key, value);
    }
  }
  return merged;
}

/* v8 ignore start -- interactive entry point; reconcileAccessGate holds the logic and is tested. */
/**
 * Runs the Access gate phase from `pnpm bootstrap --access-gate`.
 *
 * @param projectRoot - Repository root.
 * @param doctorMode - Report findings without changing anything.
 */
export async function runAccessGatePhase(
  projectRoot: string,
  target: HostedDeployTarget,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  const envFile = hostedEnvFilePath(projectRoot, target);
  const rerunCommand = `pnpm bootstrap --access-gate --target ${target === "production" ? "prod" : "staging"}`;
  const envFiles = [
    envFile,
    path.join(projectRoot, ".env"),
    path.join(projectRoot, "admin", ".env"),
  ];
  const env = mergedEnv(envFiles);
  let config: AccessGateConfig;
  try {
    config = readAccessGateConfig(env, target);
  } catch (error) {
    log.error((error as Error).message);
    followUpItems.push(
      `Set ATLAS_ADMIN_PUBLIC_URL, ATLAS_PLATFORM_OPERATOR_EMAILS and ATLAS_ACCESS_EMAIL_DOMAIN in ${path.basename(envFile)}.`,
    );
    return { followUpItems, status: "blocked", success: false };
  }
  const accountId = env.get("CLOUDFLARE_ACCOUNT_ID")?.trim();
  if (!accountId) {
    log.error(
      "CLOUDFLARE_ACCOUNT_ID is required: the Access gate must be created in Atlas's account.",
    );
    followUpItems.push(
      `Set CLOUDFLARE_ACCOUNT_ID in ${path.basename(envFile)} to the Rebuilding America account.`,
    );
    return { followUpItems, status: "blocked", success: false };
  }

  log.step(
    `Checking the Cloudflare Access gate for ${pc.cyan(config.hostname)}`,
  );
  const acquired = await acquireCloudflareToken({
    permissionLines: ACCESS_TOKEN_PERMISSIONS,
    tokenNameHint: "Atlas Access gate setup",
    zoneHint: config.hostname.split(".").slice(-2).join("."),
  });
  const result = reconcileAccessGate(
    createCfRunner({ accountId, apiToken: acquired.token }),
    config,
    {
      doctor: doctorMode,
    },
  );

  for (const finding of result.plan.findings) {
    const mark = finding.status === "ok" ? pc.green("✓") : pc.yellow("!");
    log.message(`${mark} ${finding.label} ${finding.detail}`);
  }
  if (result.plan.blocked) {
    log.error(result.plan.blocked);
    followUpItems.push(
      `${result.plan.blocked} Follow docs/runbooks/platform-admin-access.md, then run ${rerunCommand} again.`,
    );
    return { followUpItems, status: "blocked", success: false };
  }
  if (!result.outputs) {
    const pending = result.plan.actions.length;
    return pending === 0
      ? { followUpItems, status: "complete", success: true }
      : {
          followUpItems: [
            `Run ${rerunCommand} to make ${String(pending)} Access change(s).`,
          ],
          status: "partial",
          success: false,
        };
  }

  mergeEnvFile(
    envFile,
    new Map<string, string>(Object.entries(result.outputs)),
  );
  log.success(
    `Access gate ready. ATLAS_ACCESS_TEAM_DOMAIN and ATLAS_ACCESS_AUD saved to ${path.basename(envFile)} for the admin app.`,
  );
  return { followUpItems, status: "complete", success: true };
}
/* v8 ignore stop */
