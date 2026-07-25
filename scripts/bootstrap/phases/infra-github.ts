import { log, spinner } from "@clack/prompts";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runCommand } from "../lib/shell.js";
import { parseEnvFile } from "../lib/env-file.js";
import {
  hostedEnvFilePath,
  type HostedDeployTarget,
} from "../lib/hosted-target.js";
import { promptConfirm } from "../lib/ui.js";

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

  function envVal(key: string): string | undefined {
    const v = hostedEnv.get(key) ?? rootEnv.get(key);
    return v && v.length > 0 ? v : undefined;
  }

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
    "ATLAS_EDGE_ORIGIN_SECRET",
    "ATLAS_OPERATOR_ALLOWED_EMAILS",
    "ATLAS_EMAIL_RESEND_API_KEY",
    "OPENSTATUS_API_KEY",
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
    "ATLAS_AUTH_MEMBERSHIP_URL",
    "ATLAS_API_AUDIENCE",
    "ATLAS_AUTH_JWT_AUDIENCES",
  ];

  for (const key of appSecretKeys) {
    const value = envVal(key);
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
}
