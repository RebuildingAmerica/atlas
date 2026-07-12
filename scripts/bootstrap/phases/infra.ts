import path from "node:path";
import { log } from "@clack/prompts";
import { mergeEnvFile } from "../lib/env-file.js";
import { runCommand } from "../lib/shell.js";
import { type PhaseResult, type ReadinessState } from "../state.js";

import { SA_NAME } from "./infra-constants.js";
import {
  chooseRegion,
  readPersistedInfraConfig,
  setupProject,
} from "./infra-project.js";
import {
  enableApis,
  ensureArtifactRegistry,
  ensureServiceAccount,
  ensureWorkloadIdentityFederation,
} from "./infra-cloud.js";
import { setGithubSecrets } from "./infra-github.js";

export interface InfraResult extends PhaseResult {
  projectId: string;
  projectNumber: string;
  region: string;
  saEmail: string;
  wifProvider: string;
  githubRepo: string;
}

export async function runInfraPhase(
  projectRoot: string,
  state: ReadinessState,
  doctorMode: boolean,
  assumeYes = false,
): Promise<InfraResult> {
  const followUpItems: string[] = [];
  const persistedConfig = readPersistedInfraConfig(projectRoot);

  const gcloudAuth = runCommand(
    "gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1 | grep -q .",
  );
  if (!gcloudAuth.ok) {
    log.error(
      "gcloud is not authenticated. Run 'gcloud auth login' first, then re-run bootstrap.",
    );
    return emptyResult(["Authenticate gcloud: gcloud auth login"], false);
  }

  const gcloudToken = runCommand(
    "gcloud auth print-access-token --quiet >/dev/null 2>&1",
  );
  if (!gcloudToken.ok) {
    log.error(
      "gcloud needs to reauthenticate before Atlas can manage your GCP project. Run 'gcloud auth login' and then re-run bootstrap.",
    );
    return emptyResult(["Reauthenticate gcloud: gcloud auth login"], false);
  }

  const ghAuth = runCommand("gh auth status 2>/dev/null");
  if (!ghAuth.ok) {
    log.error(
      "GitHub CLI is not authenticated. Run 'gh auth login' first, then re-run bootstrap.",
    );
    return emptyResult(["Authenticate GitHub CLI: gh auth login"], false);
  }

  const repoResult = runCommand(
    "gh repo view --json nameWithOwner -q '.nameWithOwner'",
  );
  if (!repoResult.ok) {
    log.error(
      "Could not detect GitHub repo. Make sure you are in the atlas repo root.",
    );
    return emptyResult(followUpItems, false);
  }
  const githubRepo = repoResult.stdout;

  const { projectId, projectNumber } = await setupProject(
    doctorMode,
    followUpItems,
    persistedConfig.projectId,
    assumeYes,
  );
  if (!projectId) {
    return emptyResult(followUpItems, false);
  }

  const region = await chooseRegion(
    doctorMode,
    persistedConfig.region,
    followUpItems,
    assumeYes,
  );

  enableApis(projectId, doctorMode, followUpItems);
  ensureArtifactRegistry(projectId, region, doctorMode, followUpItems);

  const saEmail = `${SA_NAME}@${projectId}.iam.gserviceaccount.com`;
  ensureServiceAccount(projectId, saEmail, doctorMode, followUpItems);

  const wifProvider = ensureWorkloadIdentityFederation(
    projectId,
    projectNumber,
    saEmail,
    githubRepo,
    doctorMode,
    followUpItems,
  );

  await setGithubSecrets(
    githubRepo,
    projectId,
    region,
    saEmail,
    wifProvider,
    doctorMode,
    followUpItems,
    assumeYes,
  );

  if (!doctorMode) {
    const infraVars = new Map([
      ["GCP_PROJECT_ID", projectId],
      ["GCP_REGION", region],
      ["GCP_SERVICE_ACCOUNT", saEmail],
      ["GCP_WORKLOAD_IDENTITY_PROVIDER", wifProvider],
    ]);
    mergeEnvFile(path.join(projectRoot, ".env.production"), infraVars);
    log.success("Infrastructure values written to .env.production");
  }

  const allSucceeded = followUpItems.length === 0;
  return {
    success: allSucceeded,
    followUpItems,
    projectId,
    projectNumber,
    region,
    saEmail,
    wifProvider,
    githubRepo,
  };
}

function emptyResult(followUpItems: string[], success: boolean): InfraResult {
  return {
    success,
    followUpItems,
    projectId: "",
    projectNumber: "",
    region: "",
    saEmail: "",
    wifProvider: "",
    githubRepo: "",
  };
}
