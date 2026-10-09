import { log, spinner } from "@clack/prompts";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runCommand } from "../lib/shell.js";
import { parseEnvFile } from "../lib/env-file.js";
import { isPlaceholder } from "../lib/secret.js";
import {
  hostedEnvFilePath,
  type HostedDeployTarget,
} from "../lib/hosted-target.js";
import { promptConfirm } from "../lib/ui.js";

/**
 * The value bootstrap uploads as a GitHub Environment secret, if any.
 *
 * The hosted env file wins, and a value it leaves empty stays unset. A
 * template placeholder is not a value, though: uploading one would satisfy the
 * deploy workflow's missing-secret check while leaving a guessable secret, so
 * it falls through to the root .env the way deploy-config does.
 */
export function resolveGithubSecretValue(
  key: string,
  hostedEnv: Map<string, string>,
  rootEnv: Map<string, string>,
): string | undefined {
  for (const env of [hostedEnv, rootEnv]) {
    const value = env.get(key);
    if (value === undefined) continue;
    if (value.length === 0) return undefined;
    if (!isPlaceholder(value)) return value;
  }
  return undefined;
}

/**
 * Settings the deploy workflows read as GitHub Environment variables rather
 * than secrets: none of them is secret, and keeping them visible makes a wrong
 * operator list or admin host easy to spot.
 */
export const GITHUB_VARIABLE_KEYS = [
  "ATLAS_INSTANCE_OPERATOR_EMAILS",
  "ATLAS_PLATFORM_OPERATOR_EMAILS",
  "ATLAS_ADMIN_PUBLIC_URL",
  "ATLAS_PLATFORM_API_URL",
  "ATLAS_ACCESS_TEAM_DOMAIN",
  "ATLAS_ACCESS_AUD",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

/**
 * The GitHub Environment variables bootstrap writes, from the same env files
 * and with the same precedence as secrets.
 */
export function githubVariablesFor(
  hostedEnv: Map<string, string>,
  rootEnv: Map<string, string>,
): Map<string, string> {
  const variables = new Map<string, string>();
  for (const key of GITHUB_VARIABLE_KEYS) {
    const value = resolveGithubSecretValue(key, hostedEnv, rootEnv);
    if (value) variables.set(key, value);
  }
  return variables;
}

export async function setGithubSecrets(
  githubRepo: string,
  target: HostedDeployTarget,
  projectId: string,
  region: string,
  saEmail: string,
  wifProvider: string,
  doctorMode: boolean,
  followUpItems: string[],
  assumeYes = false,
): Promise<void> {
  if (doctorMode) {
    log.info("Skipping GitHub secrets in doctor mode");
    followUpItems.push("Verify GitHub repository secrets are set");
    return;
  }

  const environmentName = target;

  const shouldSet =
    assumeYes ||
    (await promptConfirm(
      [
        `Set GitHub Environment secrets for ${githubRepo} (${environmentName})?`,
        "",
        "Bootstrap will write deploy and app runtime values from local env files into the",
        `GitHub "${environmentName}" Environment's secrets, scoped to that environment only.`,
        "Choose Yes only if this repository is the Atlas deployment repository.",
        "Choose No to skip CI/CD secret sync for now.",
      ].join("\n"),
      true,
    ));

  if (!shouldSet) {
    log.warn("Skipped GitHub secrets. Set them manually before deploying.");
    followUpItems.push(
      `Set GitHub "${environmentName}" Environment secrets for CI/CD`,
    );
    return;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, "../../..");
  const hostedEnv = parseEnvFile(hostedEnvFilePath(projectRoot, target));
  const rootEnv = parseEnvFile(path.join(projectRoot, ".env"));

  const secrets = new Map<string, string>([
    ["GCP_PROJECT_ID", projectId],
    ["GCP_REGION", region],
    ["GCP_SERVICE_ACCOUNT", saEmail],
    ["GCP_WORKLOAD_IDENTITY_PROVIDER", wifProvider],
  ]);

  const appSecretKeys = [
    "DATABASE_URL",
    "ATLAS_PUBLIC_URL",
    "ANTHROPIC_API_KEY",
    "ATLAS_AUTH_INTERNAL_SECRET",
    "ATLAS_AUTH_CALLBACK_SECRET",
    "ATLAS_EDGE_ORIGIN_SECRET",
    "ATLAS_EMAIL_RESEND_API_KEY",
    "OPENSTATUS_API_KEY",
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
    "ATLAS_AUTH_MEMBERSHIP_URL",
    "ATLAS_API_AUDIENCE",
    "ATLAS_AUTH_JWT_AUDIENCES",
  ];

  for (const key of appSecretKeys) {
    const value = resolveGithubSecretValue(key, hostedEnv, rootEnv);
    if (value) secrets.set(key, value);
  }

  const s = spinner();
  s.start(`Setting GitHub "${environmentName}" Environment secrets...`);

  let failedSecrets = 0;

  for (const [key, value] of secrets) {
    const result = runCommand(
      `gh secret set "${key}" --body "${value}" --repo "${githubRepo}" --env "${environmentName}"`,
    );
    if (!result.ok) {
      failedSecrets++;
      followUpItems.push(`Set GitHub secret: ${key} (${environmentName})`);
    }
  }

  if (failedSecrets > 0) {
    s.stop(
      `Set ${secrets.size - failedSecrets}/${secrets.size} GitHub "${environmentName}" secrets`,
    );
    log.warn(`${failedSecrets} secret(s) failed to set`);
  } else {
    s.stop(
      `GitHub "${environmentName}" Environment secrets configured (${secrets.size} total)`,
    );
  }

  for (const [key, value] of githubVariablesFor(hostedEnv, rootEnv)) {
    const result = runCommand(
      `gh variable set "${key}" --body "${value}" --repo "${githubRepo}" --env "${environmentName}"`,
    );
    if (!result.ok) {
      followUpItems.push(`Set GitHub variable: ${key} (${environmentName})`);
    }
  }
}
