/**
 * What the Cloud Run service is configured with, read from the env files.
 *
 * The public URL, API base URL and JWT audience each have a fallback chain
 * worth keeping out of the deploy sequence itself.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { log } from "@clack/prompts";
import { parseEnvFile } from "../lib/env-file.js";
import {
  hostedEnvFilePath,
  type HostedDeployTarget,
} from "../lib/hosted-target.js";
import { isPlaceholder } from "../lib/secret.js";
import {
  SCHEDULED_DISCOVERY_PATH,
  SCHEDULER_SA_NAME,
} from "./infra-constants.js";

export interface DeployConfig {
  projectId: string;
  region: string;
  imageBase: string;
  databaseUrl: string;
  anthropicApiKey: string;
  searchApiKey: string;
  authCallbackSecret: string;
  authApiKeyIntrospectionUrl: string;
  authMembershipUrl: string;
  edgeOriginSecret: string;
  publicUrl: string;
  authJwtAudiences: string;
  instanceOperatorEmails: string;
  machineTrustedIssuers: string;
}

interface AtlasApiCloudRunEnvConfig {
  databaseUrl: string;
  anthropicApiKey: string;
  searchApiKey: string;
  authCallbackSecret: string;
  authApiKeyIntrospectionUrl: string;
  authMembershipUrl: string;
  edgeOriginSecret: string;
  publicUrl: string;
  authJwtAudiences: string;
  instanceOperatorEmails: string;
  machineTrustedIssuers: string;
}

interface GoogleOidcMachineIssuer {
  kind: "google_oidc";
  name: string;
  service_account: string;
  audience: string;
  actions: string[];
}

/**
 * The machine issuers a hosted deploy trusts: Cloud Scheduler's account,
 * allowed only to start the scheduled discovery run. It matches what the
 * deploy workflow writes, so a bootstrap redeploy never drops the trust the
 * nightly run depends on.
 */
export function buildHostedMachineIssuers(
  projectId: string,
  publicUrl: string,
): string {
  const issuers: GoogleOidcMachineIssuer[] = [
    {
      kind: "google_oidc",
      name: "cloud-scheduler",
      service_account: `${SCHEDULER_SA_NAME}@${projectId}.iam.gserviceaccount.com`,
      audience: `${publicUrl.replace(/\/+$/, "")}${SCHEDULED_DISCOVERY_PATH}`,
      actions: ["machine.runs.trigger_scheduled"],
    },
  ];
  return JSON.stringify(issuers);
}

export function formatCloudRunEnvVarsFileContent(
  envVars: Record<string, string>,
): string {
  return `${JSON.stringify(envVars, null, 2)}\n`;
}

export function buildAtlasApiCloudRunEnvVars(
  config: AtlasApiCloudRunEnvConfig,
): Record<string, string> {
  return {
    ENVIRONMENT: "production",
    LOG_LEVEL: "info",
    DATABASE_BACKEND: "postgres",
    DATABASE_URL: config.databaseUrl,
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    SEARCH_API_KEY: config.searchApiKey,
    ATLAS_AUTH_CALLBACK_SECRET: config.authCallbackSecret,
    ATLAS_AUTH_API_KEY_INTROSPECTION_URL: config.authApiKeyIntrospectionUrl,
    ATLAS_AUTH_MEMBERSHIP_URL: config.authMembershipUrl,
    ATLAS_EDGE_ORIGIN_SECRET: config.edgeOriginSecret,
    ATLAS_PUBLIC_URL: config.publicUrl,
    ATLAS_AUTH_JWT_AUDIENCES: config.authJwtAudiences,
    ATLAS_INSTANCE_OPERATOR_EMAILS: config.instanceOperatorEmails,
    ATLAS_MACHINE_TRUSTED_ISSUERS: config.machineTrustedIssuers,
  };
}

export function readDeployConfig(
  projectRoot: string,
  target: HostedDeployTarget,
): DeployConfig | undefined {
  // Try to read values from env files and state
  const rootEnv = readEnvMap(path.join(projectRoot, ".env"));
  const hostedEnv = readEnvMap(hostedEnvFilePath(projectRoot, target));
  const apiEnv = readEnvMap(path.join(projectRoot, "api", ".env"));

  function resolve(key: string): string {
    for (const env of [hostedEnv, rootEnv, apiEnv]) {
      const value = env.get(key)?.trim();
      if (value && !isPlaceholder(value)) {
        return value;
      }
    }
    return "";
  }

  const projectId = resolve("GCP_PROJECT_ID");
  const region = resolve("GCP_REGION") || "us-central1";
  const databaseUrl = resolve("DATABASE_URL");
  const anthropicApiKey = resolve("ANTHROPIC_API_KEY");
  const searchApiKey = resolve("SEARCH_API_KEY");
  const authCallbackSecret = resolve("ATLAS_AUTH_CALLBACK_SECRET");
  const edgeOriginSecret = resolve("ATLAS_EDGE_ORIGIN_SECRET");
  const publicUrl =
    resolve("ATLAS_PUBLIC_URL") ||
    (target === "production" ? "https://atlas.rebuildingus.org" : "");
  if (!publicUrl) {
    log.error(`ATLAS_PUBLIC_URL not found in env files for ${target}.`);
    return undefined;
  }
  const authApiKeyIntrospectionUrl = resolveHostedUrl(
    resolve("ATLAS_AUTH_API_KEY_INTROSPECTION_URL"),
    new URL("/api/auth/internal/api-key", publicUrl).toString(),
  );
  const authMembershipUrl = resolveHostedUrl(
    resolve("ATLAS_AUTH_MEMBERSHIP_URL"),
    publicUrl,
  );
  const authJwtAudiences = resolveAuthJwtAudiences(
    resolve("ATLAS_AUTH_JWT_AUDIENCES"),
    publicUrl,
    resolve("ATLAS_SERVER_API_PROXY_TARGET"),
  );

  if (!projectId) {
    log.error("GCP_PROJECT_ID not found in env files.");
    return undefined;
  }

  if (!databaseUrl) {
    log.error("DATABASE_URL not found in env files.");
    return undefined;
  }

  if (!anthropicApiKey) {
    log.error("ANTHROPIC_API_KEY not found in env files.");
    return undefined;
  }

  if (!authCallbackSecret) {
    log.error("ATLAS_AUTH_CALLBACK_SECRET not found in env files.");
    return undefined;
  }

  if (!authApiKeyIntrospectionUrl) {
    log.error("ATLAS_AUTH_API_KEY_INTROSPECTION_URL not found in env files.");
    return undefined;
  }

  if (!authMembershipUrl) {
    log.error("ATLAS_AUTH_MEMBERSHIP_URL not found in env files.");
    return undefined;
  }

  if (!edgeOriginSecret) {
    log.error("ATLAS_EDGE_ORIGIN_SECRET not found in env files.");
    return undefined;
  }

  const imageBase = `${region}-docker.pkg.dev/${projectId}/${REPO_NAME}`;

  return {
    projectId,
    region,
    imageBase,
    databaseUrl,
    anthropicApiKey,
    searchApiKey,
    authCallbackSecret,
    authApiKeyIntrospectionUrl,
    authMembershipUrl,
    edgeOriginSecret,
    publicUrl,
    authJwtAudiences,
    instanceOperatorEmails: resolve("ATLAS_INSTANCE_OPERATOR_EMAILS"),
    machineTrustedIssuers: buildHostedMachineIssuers(projectId, publicUrl),
  };
}

function resolveAuthJwtAudiences(
  configuredAudiences: string,
  publicUrl: string,
  apiBaseUrl: string,
): string {
  const canonicalAudiences = buildAuthJwtAudiences(publicUrl, apiBaseUrl);
  const expectedFirstAudience = canonicalAudiences.split(",")[0];
  const configuredFirstAudience = configuredAudiences
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);

  return configuredFirstAudience === expectedFirstAudience
    ? configuredAudiences
    : canonicalAudiences;
}

function buildAuthJwtAudiences(publicUrl: string, apiBaseUrl: string): string {
  const audiences = [new URL("/mcp", publicUrl).toString().replace(/\/$/, "")];
  const apiOrigin = apiBaseUrl ? new URL(apiBaseUrl).origin : "";
  if (apiOrigin) {
    audiences.push(apiOrigin);
  }
  return audiences.join(",");
}

function readEnvMap(filePath: string): Map<string, string> {
  if (!existsSync(filePath)) return new Map();
  return parseEnvFile(filePath);
}

function resolveHostedUrl(
  configuredValue: string,
  fallbackValue: string,
): string {
  if (!configuredValue || isLocalUrl(configuredValue)) {
    return fallbackValue;
  }
  return configuredValue;
}

function isLocalUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

const REPO_NAME = "atlas-images";
