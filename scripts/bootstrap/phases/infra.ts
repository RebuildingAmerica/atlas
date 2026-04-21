import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, spinner, text, select } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../lib/types.js";
import { runCommand, commandOutput } from "../lib/shell.js";
import { mergeEnvFile, parseEnvFile } from "../lib/env-file.js";
import { promptOrExit, promptConfirm, logSubline } from "../lib/ui.js";
import type { ReadinessState } from "../state.js";

const REQUIRED_APIS = [
  "run.googleapis.com",
  "artifactregistry.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
];

const SERVICE_ACCOUNT_ROLES = [
  "roles/run.admin",
  "roles/artifactregistry.writer",
  "roles/iam.serviceAccountUser",
];

const REPO_NAME = "atlas-images";
const SA_NAME = "atlas-deploy";
const POOL_NAME = "github-pool";
const PROVIDER_NAME = "github-provider";

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
): Promise<InfraResult> {
  const followUpItems: string[] = [];

  // ── Gate: require gcloud + gh auth ────────────────────────────────────────
  const gcloudAuth = runCommand(
    "gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1 | grep -q .",
  );
  if (!gcloudAuth.ok) {
    log.error(
      "gcloud is not authenticated. Run 'gcloud auth login' first, then re-run bootstrap.",
    );
    return emptyResult(["Authenticate gcloud: gcloud auth login"], false);
  }

  const ghAuth = runCommand("gh auth status 2>/dev/null");
  if (!ghAuth.ok) {
    log.error(
      "GitHub CLI is not authenticated. Run 'gh auth login' first, then re-run bootstrap.",
    );
    return emptyResult(["Authenticate GitHub CLI: gh auth login"], false);
  }

  // ── Detect GitHub repo ────────────────────────────────────────────────────
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
  logSubline(`GitHub repo: ${pc.cyan(githubRepo)}`);

  // ── GCP Project ───────────────────────────────────────────────────────────
  const { projectId, projectNumber } = await setupProject(
    doctorMode,
    followUpItems,
  );
  if (!projectId) {
    return emptyResult(followUpItems, false);
  }

  // ── Region ────────────────────────────────────────────────────────────────
  logSubline(
    pc.dim(
      "Pick the GCP region closest to your users. us-central1 (Iowa) is the cheapest for Cloud Run and has the widest free tier. See https://cloud.google.com/run/docs/locations",
    ),
  );
  const region = (await promptOrExit(
    text({
      message: "GCP region",
      initialValue: "us-central1",
    }),
  )) as string;
  logSubline(`Region: ${pc.cyan(region)}`);

  // ── Enable APIs ───────────────────────────────────────────────────────────
  enableApis(projectId, doctorMode, followUpItems);

  // ── Artifact Registry ─────────────────────────────────────────────────────
  ensureArtifactRegistry(region, doctorMode, followUpItems);

  // ── Service Account ───────────────────────────────────────────────────────
  const saEmail = `${SA_NAME}@${projectId}.iam.gserviceaccount.com`;
  ensureServiceAccount(projectId, saEmail, doctorMode, followUpItems);

  // ── Workload Identity Federation ──────────────────────────────────────────
  const wifProvider = ensureWorkloadIdentityFederation(
    projectId,
    projectNumber,
    saEmail,
    githubRepo,
    doctorMode,
    followUpItems,
  );

  // ── GitHub Secrets ────────────────────────────────────────────────────────
  await setGithubSecrets(
    githubRepo,
    projectId,
    region,
    saEmail,
    wifProvider,
    doctorMode,
    followUpItems,
  );

  // ── Write infra values to env files ────────────────────────────────────────
  if (!doctorMode) {
    const infraVars = new Map([
      ["GCP_PROJECT_ID", projectId],
      ["GCP_REGION", region],
      ["GCP_SERVICE_ACCOUNT", saEmail],
      ["GCP_WORKLOAD_IDENTITY_PROVIDER", wifProvider],
    ]);
    const prodEnvPath = path.join(projectRoot, ".env.production");
    mergeEnvFile(prodEnvPath, infraVars);
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

// ── Project Setup ─────────────────────────────────────────────────────────────

interface ProjectInfo {
  projectId: string;
  projectNumber: string;
}

async function setupProject(
  doctorMode: boolean,
  followUpItems: string[],
): Promise<ProjectInfo> {
  const listResult = runCommand(
    'gcloud projects list --format="value(projectId)" --limit=20',
  );

  if (listResult.ok && listResult.stdout) {
    const projects = listResult.stdout.split("\n").filter(Boolean);
    if (projects.length > 0) {
      logSubline(`Found ${projects.length} existing project(s)`);
    }
  }

  logSubline(
    pc.dim(
      "Atlas needs a GCP project for Cloud Run hosting. You can use an existing project or create a new one. Project IDs are globally unique (e.g., 'atlas-prod-123').",
    ),
  );

  const projectAction = (await promptOrExit(
    select({
      message: "GCP project",
      options: [
        { value: "existing", label: "Use an existing project" },
        { value: "new", label: "Create a new project" },
      ],
    }),
  )) as string;

  const projectId = (await promptOrExit(
    text({
      message:
        projectAction === "new"
          ? "New GCP project ID (globally unique, lowercase, hyphens allowed)"
          : "Existing GCP project ID",
      placeholder: "atlas-prod",
    }),
  )) as string;

  if (doctorMode) {
    const describeResult = runCommand(
      `gcloud projects describe "${projectId}" 2>/dev/null`,
    );
    if (!describeResult.ok) {
      log.warn(`Project '${projectId}' does not exist or is inaccessible`);
      followUpItems.push(`Create or verify GCP project: ${projectId}`);
      return { projectId: "", projectNumber: "" };
    }
    const numResult = runCommand(
      `gcloud projects describe "${projectId}" --format="value(projectNumber)"`,
    );
    log.success(`Project '${projectId}' exists`);
    return { projectId, projectNumber: numResult.stdout };
  }

  // Check if project exists
  const describeResult = runCommand(
    `gcloud projects describe "${projectId}" 2>/dev/null`,
  );

  if (describeResult.ok) {
    log.success(`Project '${projectId}' exists`);
  } else {
    if (projectAction !== "new") {
      const shouldCreate = await promptConfirm(
        `Project '${projectId}' does not exist. Create it?`,
        true,
      );
      if (!shouldCreate) {
        log.error("Cannot proceed without a valid GCP project.");
        followUpItems.push(`Create GCP project: ${projectId}`);
        return { projectId: "", projectNumber: "" };
      }
    }

    const s = spinner();
    s.start(`Creating project '${projectId}'...`);
    const createResult = runCommand(`gcloud projects create "${projectId}"`);
    if (!createResult.ok) {
      s.stop(`Failed to create project '${projectId}'`);
      log.error(commandOutput(createResult));
      followUpItems.push(`Create GCP project manually: ${projectId}`);
      return { projectId: "", projectNumber: "" };
    }
    s.stop(`Project '${projectId}' created`);
  }

  // Set active project
  runCommand(`gcloud config set project "${projectId}" --quiet`);

  // Get project number
  const numResult = runCommand(
    `gcloud projects describe "${projectId}" --format="value(projectNumber)"`,
  );
  if (!numResult.ok) {
    log.error("Failed to get project number.");
    followUpItems.push("Retrieve GCP project number");
    return { projectId: "", projectNumber: "" };
  }
  const projectNumber = numResult.stdout;
  logSubline(`Project number: ${pc.dim(projectNumber)}`);

  // Check billing
  const billingResult = runCommand(
    `gcloud billing projects describe "${projectId}" --format="value(billingAccountName)" 2>/dev/null`,
  );
  const billingAccount = billingResult.ok ? billingResult.stdout : "";

  if (!billingAccount) {
    log.warn("No billing account linked to this project.");
    logSubline(
      `Link one at: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`,
    );
    const billingReady = await promptConfirm("Is billing now enabled?", false);
    if (!billingReady) {
      log.error("Cloud Run requires billing. Cannot proceed.");
      followUpItems.push(`Enable billing for GCP project: ${projectId}`);
      return { projectId: "", projectNumber: "" };
    }
  } else {
    logSubline("Billing enabled");
  }

  return { projectId, projectNumber };
}

// ── Enable APIs ───────────────────────────────────────────────────────────────

function enableApis(
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

// ── Artifact Registry ─────────────────────────────────────────────────────────

function ensureArtifactRegistry(
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

// ── Service Account ───────────────────────────────────────────────────────────

function ensureServiceAccount(
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

  // Grant IAM roles
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

// ── Workload Identity Federation ──────────────────────────────────────────────

function ensureWorkloadIdentityFederation(
  projectId: string,
  projectNumber: string,
  saEmail: string,
  githubRepo: string,
  doctorMode: boolean,
  followUpItems: string[],
): string {
  const wifProvider = `projects/${projectNumber}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}`;

  // Create pool
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

  // Create OIDC provider
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

  // Bind service account to pool
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

// ── GitHub Secrets ────────────────────────────────────────────────────────────

async function setGithubSecrets(
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
    `Set GitHub secrets for ${githubRepo}?`,
    true,
  );

  if (!shouldSet) {
    log.warn("Skipped GitHub secrets. Set them manually before deploying.");
    followUpItems.push("Set GitHub repository secrets for CI/CD");
    return;
  }

  // Read app secrets from env files to push alongside infra secrets
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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
