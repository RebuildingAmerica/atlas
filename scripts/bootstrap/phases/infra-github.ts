import { log, spinner } from "@clack/prompts";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runCommand } from "../lib/shell.js";
import { parseEnvFile } from "../lib/env-file.js";
import { promptConfirm } from "../lib/ui.js";

export async function setGithubSecrets(
  githubRepo: string,
  projectId: string,
  region: string,
  saEmail: string,
  wifProvider: string,
  doctorMode: boolean,
  followUpItems: string[],
): Promise<void> {
  if (doctorMode) {
    log.info("Skipping GitHub secrets in doctor mode");
    followUpItems.push("Verify GitHub repository secrets are set");
    return;
  }

  const shouldSet = await promptConfirm(
    [
      `Set GitHub secrets for ${githubRepo}?`,
      "",
      "Bootstrap will write deploy and app runtime values from local env files into GitHub Actions secrets.",
      "Choose Yes only if this repository is the Atlas deployment repository.",
      "Choose No to skip CI/CD secret sync for now.",
    ].join("\n"),
    true,
  );

  if (!shouldSet) {
    log.warn("Skipped GitHub secrets. Set them manually before deploying.");
    followUpItems.push("Set GitHub repository secrets for CI/CD");
    return;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, "../../..");
  const prodEnv = parseEnvFile(path.join(projectRoot, ".env.production"));
  const rootEnv = parseEnvFile(path.join(projectRoot, ".env"));

  function envVal(key: string): string | undefined {
    const v = prodEnv.get(key) ?? rootEnv.get(key);
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
    "ATLAS_AUTH_ALLOWED_EMAILS",
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
  s.start("Setting GitHub repository secrets...");

  let failedSecrets = 0;

  for (const [key, value] of secrets) {
    const result = runCommand(
      `gh secret set "${key}" --body "${value}" --repo "${githubRepo}"`,
    );
    if (!result.ok) {
      failedSecrets++;
      followUpItems.push(`Set GitHub secret: ${key}`);
    }
  }

  if (failedSecrets > 0) {
    s.stop(
      `Set ${secrets.size - failedSecrets}/${secrets.size} GitHub secrets`,
    );
    log.warn(`${failedSecrets} secret(s) failed to set`);
  } else {
    s.stop(`GitHub secrets configured (${secrets.size} total)`);
  }
}
