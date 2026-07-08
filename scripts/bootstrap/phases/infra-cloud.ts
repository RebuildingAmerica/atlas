import { log, spinner } from "@clack/prompts";
import pc from "picocolors";
import { commandOutput, runCommand } from "../lib/shell.js";
import { logSubline } from "../lib/ui.js";

import {
  POOL_NAME,
  PROVIDER_NAME,
  REPO_NAME,
  REQUIRED_APIS,
  SA_NAME,
  SERVICE_ACCOUNT_ROLES,
} from "./infra-constants.js";

export function enableApis(
  projectId: string,
  doctorMode: boolean,
  followUpItems: string[],
): void {
  const s = spinner();
  s.start("Enabling required GCP APIs...");

  for (const api of REQUIRED_APIS) {
    try {
      const result = runCommand(
        `gcloud services enable "${api}" --project="${projectId}" --quiet`,
      );
      if (!result.ok) {
        throw new Error(commandOutput(result));
      }
    } catch (err) {
      s.stop(`Failed to enable API: ${api}`);
      const message = err instanceof Error ? err.message : String(err);
      log.error(message);
      followUpItems.push(`Enable API manually: gcloud services enable ${api}`);
      return;
    }
  }

  s.stop("All required GCP APIs enabled");
}

export function ensureArtifactRegistry(
  region: string,
  doctorMode: boolean,
  followUpItems: string[],
): void {
  const checkResult = runCommand(
    `gcloud artifacts repositories describe "${REPO_NAME}" --location="${region}" 2>/dev/null`,
  );

  if (checkResult.ok) {
    log.success(`Artifact Registry '${REPO_NAME}' already exists`);
    return;
  }

  if (doctorMode) {
    log.warn(`Artifact Registry '${REPO_NAME}' does not exist`);
    followUpItems.push(
      `Create Artifact Registry: gcloud artifacts repositories create ${REPO_NAME} --repository-format=docker --location=${region}`,
    );
    return;
  }

  const s = spinner();
  s.start(`Creating Artifact Registry '${REPO_NAME}'...`);

  const createResult = runCommand(
    `gcloud artifacts repositories create "${REPO_NAME}" ` +
      `--repository-format=docker ` +
      `--location="${region}" ` +
      `--description="Atlas container images" ` +
      `--quiet`,
  );

  if (!createResult.ok) {
    s.stop(`Failed to create Artifact Registry '${REPO_NAME}'`);
    log.error(commandOutput(createResult));
    followUpItems.push(`Create Artifact Registry manually: ${REPO_NAME}`);
    return;
  }

  s.stop(`Artifact Registry '${REPO_NAME}' created`);
}

export function ensureServiceAccount(
  projectId: string,
  saEmail: string,
  doctorMode: boolean,
  followUpItems: string[],
): void {
  const checkResult = runCommand(
    `gcloud iam service-accounts describe "${saEmail}" 2>/dev/null`,
  );

  if (checkResult.ok) {
    log.success(`Service account '${saEmail}' already exists`);
  } else {
    if (doctorMode) {
      log.warn(`Service account '${saEmail}' does not exist`);
      followUpItems.push(
        `Create service account: gcloud iam service-accounts create ${SA_NAME}`,
      );
      return;
    }

    const s = spinner();
    s.start("Creating service account...");

    const createResult = runCommand(
      `gcloud iam service-accounts create "${SA_NAME}" ` +
        `--display-name="Atlas CI/CD Deploy" ` +
        `--quiet`,
    );

    if (!createResult.ok) {
      s.stop("Failed to create service account");
      log.error(commandOutput(createResult));
      followUpItems.push(`Create service account manually: ${SA_NAME}`);
      return;
    }

    s.stop("Service account created");
  }

  const s = spinner();
  s.start("Granting IAM roles...");

  for (const role of SERVICE_ACCOUNT_ROLES) {
    const result = runCommand(
      `gcloud projects add-iam-policy-binding "${projectId}" ` +
        `--member="serviceAccount:${saEmail}" ` +
        `--role="${role}" ` +
        `--condition=None ` +
        `--quiet 2>/dev/null`,
    );
    if (!result.ok) {
      s.stop(`Failed to grant role: ${role}`);
      log.error(commandOutput(result));
      followUpItems.push(`Grant IAM role manually: ${role}`);
    }
  }

  s.stop(`IAM roles granted: ${SERVICE_ACCOUNT_ROLES.join(", ")}`);
}

export function ensureWorkloadIdentityFederation(
  projectId: string,
  projectNumber: string,
  saEmail: string,
  githubRepo: string,
  doctorMode: boolean,
  followUpItems: string[],
): string {
  const wifProvider = `projects/${projectNumber}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}`;

  const poolCheck = runCommand(
    `gcloud iam workload-identity-pools describe "${POOL_NAME}" --location=global 2>/dev/null`,
  );

  if (poolCheck.ok) {
    log.success(`WIF pool '${POOL_NAME}' already exists`);
  } else {
    if (doctorMode) {
      log.warn(`WIF pool '${POOL_NAME}' does not exist`);
      followUpItems.push(`Create WIF pool: ${POOL_NAME}`);
      return wifProvider;
    }

    const s = spinner();
    s.start("Creating workload identity pool...");

    const poolResult = runCommand(
      `gcloud iam workload-identity-pools create "${POOL_NAME}" ` +
        `--location=global ` +
        `--display-name="GitHub Actions" ` +
        `--quiet`,
    );

    if (!poolResult.ok) {
      s.stop("Failed to create WIF pool");
      log.error(commandOutput(poolResult));
      followUpItems.push(`Create WIF pool manually: ${POOL_NAME}`);
      return wifProvider;
    }

    s.stop("Workload identity pool created");
  }

  const providerCheck = runCommand(
    `gcloud iam workload-identity-pools providers describe "${PROVIDER_NAME}" ` +
      `--workload-identity-pool="${POOL_NAME}" ` +
      `--location=global 2>/dev/null`,
  );

  if (providerCheck.ok) {
    log.success(`WIF provider '${PROVIDER_NAME}' already exists`);
  } else {
    if (doctorMode) {
      log.warn(`WIF provider '${PROVIDER_NAME}' does not exist`);
      followUpItems.push(`Create WIF OIDC provider: ${PROVIDER_NAME}`);
      return wifProvider;
    }

    const s = spinner();
    s.start("Creating OIDC provider...");

    const providerResult = runCommand(
      `gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_NAME}" ` +
        `--workload-identity-pool="${POOL_NAME}" ` +
        `--location=global ` +
        `--issuer-uri="https://token.actions.githubusercontent.com" ` +
        `--attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" ` +
        `--attribute-condition="assertion.repository == '${githubRepo}'" ` +
        `--quiet`,
    );

    if (!providerResult.ok) {
      s.stop("Failed to create OIDC provider");
      log.error(commandOutput(providerResult));
      followUpItems.push(`Create WIF OIDC provider manually: ${PROVIDER_NAME}`);
      return wifProvider;
    }

    s.stop("OIDC provider created");
  }

  const s = spinner();
  s.start("Binding service account to workload identity pool...");

  const bindingMember = `principalSet://iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${githubRepo}`;

  const bindResult = runCommand(
    `gcloud iam service-accounts add-iam-policy-binding "${saEmail}" ` +
      `--role="roles/iam.workloadIdentityUser" ` +
      `--member="${bindingMember}" ` +
      `--quiet 2>/dev/null`,
  );

  if (!bindResult.ok) {
    s.stop("Failed to bind service account to WIF pool");
    log.error(commandOutput(bindResult));
    followUpItems.push("Bind service account to WIF pool manually");
  } else {
    s.stop("Service account bound to workload identity pool");
  }

  logSubline(`WIF Provider: ${pc.dim(wifProvider)}`);
  return wifProvider;
}
