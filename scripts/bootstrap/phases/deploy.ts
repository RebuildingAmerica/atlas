import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { log, note, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../state.js";
import {
  runCommand,
  commandOutput,
  runInteractiveCommand,
  type CommandResult,
} from "../lib/shell.js";
import { parseEnvFile } from "../lib/env-file.js";
import { promptConfirm, logSubline } from "../lib/ui.js";
import type { ReadinessState } from "../state.js";

const REPO_NAME = "atlas-images";

type BuildMode = "local-docker" | "cloud-build";

export interface DockerPreflight {
  status: "ready" | "blocked";
  reason?: "daemon-unavailable" | "unknown";
}

export interface CloudBuildSourceAccessFailure {
  serviceAccount: string;
  bucket: string;
}

interface CloudBuildRecoveryOptions {
  allowAuthRecovery: boolean;
  allowSourceAccessRecovery: boolean;
}

const DEFAULT_CLOUD_BUILD_RECOVERY_OPTIONS: CloudBuildRecoveryOptions = {
  allowAuthRecovery: true,
  allowSourceAccessRecovery: true,
};

interface DeployConfig {
  projectId: string;
  region: string;
  imageBase: string;
  databaseUrl: string;
  anthropicApiKey: string;
  searchApiKey: string;
  authInternalSecret: string;
  authApiKeyIntrospectionUrl: string;
  authMembershipUrl: string;
  edgeOriginSecret: string;
  publicUrl: string;
  authJwtAudiences: string;
  allowedEmails: string;
  resendApiKey: string;
}

export async function runDeployPhase(
  projectRoot: string,
  state: ReadinessState,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];

  if (doctorMode) {
    log.info("Deploy phase skipped in doctor mode");
    return { success: true, followUpItems: [] };
  }

  const shouldDeploy = await promptConfirm(
    [
      "Deploy atlas-api to Cloud Run now?",
      "",
      "Bootstrap will build the API image, push it to Artifact Registry, and deploy the Cloud Run service.",
      "The web app is not deployed here; atlas-web ships through Vercel on push to main.",
      "Choose No if you only want setup values written and will deploy later.",
    ].join("\n"),
    false,
  );

  if (!shouldDeploy) {
    log.info(
      "Skipped initial deploy. Push to main to trigger automated deployment.",
    );
    return { success: true, status: "skipped", followUpItems: [] };
  }

  const dockerPreflight = classifyDockerPreflight(runCommand("docker info"));
  const buildMode = await resolveBuildMode(dockerPreflight);
  if (!buildMode) {
    return {
      success: false,
      status: "blocked",
      followUpItems: [formatDockerDaemonRecovery()],
    };
  }

  // ── Read infra values ─────────────────────────────────────────────────────
  const config = readDeployConfig(projectRoot);

  if (!config) {
    log.error(
      "Missing required configuration. Run the infra and database phases first.",
    );
    followUpItems.push(
      "Complete infrastructure and database setup before deploying",
    );
    return { success: false, status: "blocked", followUpItems };
  }

  // ── Configure Docker auth ─────────────────────────────────────────────────
  if (buildMode === "local-docker") {
    const s = spinner();
    s.start("Configuring Docker for Artifact Registry...");

    const dockerAuthResult = runCommand(
      `gcloud auth configure-docker "${config.region}-docker.pkg.dev" --quiet`,
    );

    if (!dockerAuthResult.ok) {
      s.stop("Failed to configure Docker authentication");
      log.error(commandOutput(dockerAuthResult));
      followUpItems.push("Configure Docker auth for Artifact Registry");
      return { success: false, status: "blocked", followUpItems };
    }

    s.stop("Docker configured for Artifact Registry");
  }

  // ── Build & Push API image ────────────────────────────────────────────────
  const apiImage = `${config.imageBase}/atlas-api:initial`;
  const apiBuilt = await buildAndPushImage(
    projectRoot,
    "atlas-api",
    projectRoot,
    "api/Dockerfile",
    apiImage,
    buildMode,
    followUpItems,
  );

  if (!apiBuilt) {
    return { success: false, status: "failed", followUpItems };
  }

  // ── Deploy atlas-api ──────────────────────────────────────────────────────
  // Ingress is `all` because Vercel proxies inbound `/api/*` traffic to this
  // service via ATLAS_SERVER_API_PROXY_TARGET; the canonical domain mapping
  // (atlas-api.<domain>) is configured separately by the api-domain phase.
  const apiUrl = deployService(
    "atlas-api",
    apiImage,
    config,
    {
      ingress: "all",
      port: 8000,
      envVars: {
        ENVIRONMENT: "production",
        LOG_LEVEL: "info",
        DATABASE_BACKEND: "postgres",
        DATABASE_URL: config.databaseUrl,
        ANTHROPIC_API_KEY: config.anthropicApiKey,
        SEARCH_API_KEY: config.searchApiKey,
        ATLAS_AUTH_INTERNAL_SECRET: config.authInternalSecret,
        ATLAS_AUTH_API_KEY_INTROSPECTION_URL: config.authApiKeyIntrospectionUrl,
        ATLAS_AUTH_MEMBERSHIP_URL: config.authMembershipUrl,
        ATLAS_EDGE_ORIGIN_SECRET: config.edgeOriginSecret,
        ATLAS_PUBLIC_URL: config.publicUrl,
        ATLAS_AUTH_JWT_AUDIENCES: config.authJwtAudiences,
      },
    },
    followUpItems,
  );

  if (!apiUrl) {
    return { success: false, status: "failed", followUpItems };
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  log.success("Cloud Run deployment complete");
  logSubline(`atlas-api: ${pc.cyan(apiUrl)}`);
  logSubline(
    pc.dim(
      "atlas-web is auto-deployed by Vercel on push to main; no Cloud Run web service.",
    ),
  );

  return { success: followUpItems.length === 0, followUpItems };
}

export function classifyDockerPreflight(
  result: CommandResult,
): DockerPreflight {
  if (result.ok) return { status: "ready" };
  const output = commandOutput(result);
  if (/docker API|docker\.sock|daemon|Cannot connect/i.test(output)) {
    return { status: "blocked", reason: "daemon-unavailable" };
  }
  return { status: "blocked", reason: "unknown" };
}

export function formatDockerDaemonRecovery(): string {
  return [
    "Start Docker Desktop, wait until `docker info` succeeds, then run `pnpm bootstrap --resume`.",
    "If local Docker is intentionally unavailable, choose the Google Cloud Build option when bootstrap asks how to build atlas-api.",
  ].join("\n");
}

export function formatDockerStartPrompt(): string {
  return [
    "Docker Desktop is installed, but the Docker daemon is not running.",
    "",
    "Start Docker Desktop now?",
    "Bootstrap will open Docker Desktop and wait until Docker is ready.",
  ].join("\n");
}

export function formatDockerBuildFallbackPrompt(): string {
  return [
    "Docker is still unavailable.",
    "",
    "Use Google Cloud Build for this deploy?",
    "Bootstrap will send the atlas-api build to Google Cloud, push the image",
    "to Artifact Registry, then continue the Cloud Run deploy.",
  ].join("\n");
}

async function resolveBuildMode(
  dockerPreflight: DockerPreflight,
): Promise<BuildMode | undefined> {
  if (dockerPreflight.status === "ready") return "local-docker";

  if (dockerPreflight.reason === "daemon-unavailable") {
    const shouldStartDocker = await promptConfirm(
      formatDockerStartPrompt(),
      true,
    );
    if (shouldStartDocker && (await startDockerDesktopAndWait())) {
      return "local-docker";
    }
  }

  const useCloudBuild = await promptConfirm(
    formatDockerBuildFallbackPrompt(),
    true,
  );
  return useCloudBuild ? "cloud-build" : undefined;
}

async function startDockerDesktopAndWait(): Promise<boolean> {
  if (process.platform !== "darwin") {
    log.warn(formatDockerDaemonRecovery());
    return false;
  }

  const openResult = runCommand("open -a Docker");
  if (!openResult.ok) {
    log.warn(commandOutput(openResult));
    return false;
  }

  const s = spinner();
  s.start("Waiting for Docker Desktop...");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const info = runCommand("docker info");
    if (info.ok) {
      s.stop("Docker Desktop is running");
      return true;
    }
    await setTimeout(3000);
  }
  s.stop("Docker Desktop did not become ready yet");
  return false;
}

// ── Build & Push ──────────────────────────────────────────────────────────────

async function buildAndPushImage(
  serviceName: string,
  contextDir: string,
  dockerfilePath: string,
  imageTag: string,
  buildMode: BuildMode,
  followUpItems: string[],
): Promise<boolean> {
  if (buildMode === "cloud-build") {
    return await buildAndPushImageWithCloudBuild(
      serviceName,
      contextDir,
      dockerfilePath,
      imageTag,
      followUpItems,
    );
  }

  // Build
  const buildSpinner = spinner();
  buildSpinner.start(`Building ${serviceName}...`);

  const buildResult = runCommand(
    formatDockerBuildCommand(contextDir, dockerfilePath, imageTag),
  );

  if (!buildResult.ok) {
    buildSpinner.stop(`Failed to build ${serviceName}`);
    log.error(commandOutput(buildResult));
    followUpItems.push(`Fix Docker build for ${serviceName}`);
    return false;
  }

  buildSpinner.stop(`${serviceName} image built`);

  // Push
  const pushSpinner = spinner();
  pushSpinner.start(`Pushing ${serviceName} image...`);

  const pushResult = runCommand(`docker push "${imageTag}"`);

  if (!pushResult.ok) {
    pushSpinner.stop(`Failed to push ${serviceName} image`);
    log.error(commandOutput(pushResult));
    followUpItems.push(`Push ${serviceName} image to Artifact Registry`);
    return false;
  }

  pushSpinner.stop(`${serviceName} image pushed`);
  return true;
}

async function buildAndPushImageWithCloudBuild(
  serviceName: string,
  contextDir: string,
  dockerfilePath: string,
  imageTag: string,
  followUpItems: string[],
  recoveryOptions: CloudBuildRecoveryOptions = DEFAULT_CLOUD_BUILD_RECOVERY_OPTIONS,
): Promise<boolean> {
  const s = spinner();
  s.start(`Building ${serviceName} with Google Cloud Build...`);

  const cloudBuildConfigPath = path.join(
    tmpdir(),
    `atlas-${serviceName}-cloudbuild-${Date.now()}.json`,
  );
  writeFileSync(
    cloudBuildConfigPath,
    formatCloudBuildDockerConfig(
      formatCloudBuildDockerfilePath(contextDir, dockerfilePath),
      imageTag,
    ),
    "utf8",
  );

  const result = runCommand(
    formatCloudBuildSubmitCommand(contextDir, cloudBuildConfigPath),
  );
  try {
    unlinkSync(cloudBuildConfigPath);
  } catch {
    // Temporary build config cleanup is best-effort; a stale file should not
    // hide the actual Cloud Build result from the operator.
  }

  if (!result.ok) {
    s.stop(`Failed to build ${serviceName} with Google Cloud Build`);
    if (
      recoveryOptions.allowAuthRecovery &&
      isGcloudReauthenticationFailure(result) &&
      (await recoverGcloudAuthentication())
    ) {
      return await buildAndPushImageWithCloudBuild(
        serviceName,
        contextDir,
        dockerfilePath,
        imageTag,
        followUpItems,
        {
          ...recoveryOptions,
          allowAuthRecovery: false,
        },
      );
    }

    const sourceAccessFailure = parseCloudBuildSourceAccessFailure(result);
    if (
      recoveryOptions.allowSourceAccessRecovery &&
      sourceAccessFailure &&
      (await recoverCloudBuildSourceAccess(sourceAccessFailure))
    ) {
      return await buildAndPushImageWithCloudBuild(
        serviceName,
        contextDir,
        dockerfilePath,
        imageTag,
        followUpItems,
        {
          ...recoveryOptions,
          allowSourceAccessRecovery: false,
        },
      );
    }

    log.error(commandOutput(result));
    followUpItems.push(
      isGcloudReauthenticationFailure(result)
        ? "Reauthenticate gcloud: gcloud auth login"
        : sourceAccessFailure
          ? formatCloudBuildSourceAccessFollowUp(sourceAccessFailure)
          : `Build ${serviceName} image with Google Cloud Build`,
    );
    return false;
  }

  s.stop(`${serviceName} image built and pushed with Google Cloud Build`);
  return true;
}

export function formatDockerBuildCommand(
  contextDir: string,
  dockerfilePath: string,
  imageTag: string,
): string {
  const resolvedDockerfile = path.isAbsolute(dockerfilePath)
    ? dockerfilePath
    : path.join(contextDir, dockerfilePath);
  return `docker build --file="${resolvedDockerfile}" -t "${imageTag}" "${contextDir}"`;
}

export function formatCloudBuildSubmitCommand(
  contextDir: string,
  configPath: string,
): string {
  return `gcloud builds submit "${contextDir}" --config="${configPath}" --quiet`;
}

export function formatCloudBuildDockerConfig(
  dockerfilePath: string,
  imageTag: string,
): string {
  return JSON.stringify(
    {
      steps: [
        {
          name: "gcr.io/cloud-builders/docker",
          args: ["build", "--file", dockerfilePath, "-t", imageTag, "."],
        },
      ],
      images: [imageTag],
    },
    null,
    2,
  );
}

function formatCloudBuildDockerfilePath(
  contextDir: string,
  dockerfilePath: string,
): string {
  return path.isAbsolute(dockerfilePath)
    ? path.relative(contextDir, dockerfilePath)
    : dockerfilePath;
}

export function parseCloudBuildSourceAccessFailure(
  result: CommandResult,
): CloudBuildSourceAccessFailure | undefined {
  const output = commandOutput(result);
  if (!/storage\.objects\.get access/i.test(output)) {
    return undefined;
  }

  const serviceAccountMatch =
    /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com)\b/.exec(output);
  const bucketMatch = /\/buckets\/([^/\s]+)\/objects\//.exec(output);

  if (!serviceAccountMatch?.[1] || !bucketMatch?.[1]) {
    return undefined;
  }

  return {
    serviceAccount: serviceAccountMatch[1],
    bucket: bucketMatch[1],
  };
}

export function formatCloudBuildSourceAccessGrantCommand(
  failure: CloudBuildSourceAccessFailure,
): string {
  return (
    `gcloud storage buckets add-iam-policy-binding "gs://${failure.bucket}" ` +
    `--member="serviceAccount:${failure.serviceAccount}" ` +
    `--role="roles/storage.objectViewer" ` +
    "--quiet"
  );
}

export function formatCloudBuildSourceAccessRecoveryNote(
  failure: CloudBuildSourceAccessFailure,
): string {
  return [
    "Cloud Build uploaded the source archive, but the build identity cannot read it back from the Cloud Build staging bucket.",
    "",
    `Service account: ${failure.serviceAccount}`,
    `Bucket: gs://${failure.bucket}`,
    "",
    "Bootstrap can grant Storage Object Viewer on that one bucket and retry the build.",
  ].join("\n");
}

export function formatCloudBuildSourceAccessFollowUp(
  failure: CloudBuildSourceAccessFailure,
): string {
  return [
    `Grant Storage Object Viewer on gs://${failure.bucket} to ${failure.serviceAccount}.`,
    "Then run `pnpm bootstrap --resume`.",
  ].join(" ");
}

async function recoverCloudBuildSourceAccess(
  failure: CloudBuildSourceAccessFailure,
): Promise<boolean> {
  note(formatCloudBuildSourceAccessRecoveryNote(failure), "Cloud Build access");
  const shouldGrant = await promptConfirm(
    "Grant Cloud Build source bucket access now?",
    true,
  );
  if (!shouldGrant) {
    return false;
  }

  const s = spinner();
  s.start("Granting Cloud Build source bucket access...");
  const grantResult = runCommand(
    formatCloudBuildSourceAccessGrantCommand(failure),
  );
  if (!grantResult.ok) {
    s.stop("Failed to grant Cloud Build source bucket access");
    log.error(commandOutput(grantResult));
    return false;
  }
  s.stop("Cloud Build source bucket access granted");
  return true;
}

export function isGcloudReauthenticationFailure(
  result: CommandResult,
): boolean {
  return /Reauthentication failed|cannot prompt during non-interactive|gcloud auth login/i.test(
    commandOutput(result),
  );
}

export function formatGcloudReauthenticationRecovery(): string {
  return [
    "Google Cloud needs a fresh interactive login before Cloud Build can continue.",
    "",
    "Bootstrap can run `gcloud auth login` now and retry Cloud Build after it succeeds.",
  ].join("\n");
}

async function recoverGcloudAuthentication(): Promise<boolean> {
  note(formatGcloudReauthenticationRecovery(), "Google Cloud authentication");
  const shouldLogin = await promptConfirm("Run `gcloud auth login` now?", true);
  if (!shouldLogin) {
    return false;
  }
  return runInteractiveCommand("gcloud auth login");
}

// ── Deploy Service ────────────────────────────────────────────────────────────

interface ServiceDeployOptions {
  ingress: "internal" | "all";
  port: number;
  envVars: Record<string, string>;
}

function deployService(
  serviceName: string,
  imageTag: string,
  config: DeployConfig,
  options: ServiceDeployOptions,
  followUpItems: string[],
): string | undefined {
  // Write env vars to a temp file to avoid comma injection with --set-env-vars
  const envFilePath = path.join(
    tmpdir(),
    `atlas-${serviceName}-env-${Date.now()}.yaml`,
  );

  try {
    const envFileContent = Object.entries(options.envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    writeFileSync(envFilePath, envFileContent, "utf8");

    const s = spinner();
    s.start(`Deploying ${serviceName}...`);

    const deployResult = runCommand(
      `gcloud run deploy "${serviceName}" ` +
        `--image="${imageTag}" ` +
        `--region="${config.region}" ` +
        `--platform=managed ` +
        `--ingress=${options.ingress} ` +
        `--allow-unauthenticated ` +
        `--min-instances=0 ` +
        `--max-instances=2 ` +
        `--memory=512Mi ` +
        `--cpu=1 ` +
        `--port=${options.port} ` +
        `--env-vars-file="${envFilePath}" ` +
        `--quiet`,
    );

    if (!deployResult.ok) {
      s.stop(`Failed to deploy ${serviceName}`);
      log.error(commandOutput(deployResult));
      followUpItems.push(`Deploy ${serviceName} to Cloud Run`);
      return undefined;
    }

    s.stop(`${serviceName} deployed`);

    // Get service URL
    const urlResult = runCommand(
      `gcloud run services describe "${serviceName}" ` +
        `--region="${config.region}" ` +
        `--format="value(status.url)"`,
    );

    const url = urlResult.ok ? urlResult.stdout : undefined;
    if (url) {
      logSubline(`${serviceName}: ${pc.cyan(url)}`);
    }
    return url;
  } finally {
    // Clean up temp env file
    try {
      unlinkSync(envFilePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ── Config Reader ─────────────────────────────────────────────────────────────

function readDeployConfig(projectRoot: string): DeployConfig | undefined {
  // Try to read values from env files and state
  const rootEnv = readEnvMap(path.join(projectRoot, ".env"));
  const prodEnv = readEnvMap(path.join(projectRoot, ".env.production"));
  const apiEnv = readEnvMap(path.join(projectRoot, "api", ".env"));

  function resolve(key: string): string {
    return prodEnv.get(key) || rootEnv.get(key) || apiEnv.get(key) || "";
  }

  const projectId = resolve("GCP_PROJECT_ID");
  const region = resolve("GCP_REGION") || "us-central1";
  const databaseUrl = resolve("DATABASE_URL");
  const anthropicApiKey = resolve("ANTHROPIC_API_KEY");
  const searchApiKey = resolve("SEARCH_API_KEY");
  const authInternalSecret = resolve("ATLAS_AUTH_INTERNAL_SECRET");
  const authApiKeyIntrospectionUrl = resolve(
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
  );
  const authMembershipUrl = resolve("ATLAS_AUTH_MEMBERSHIP_URL");
  const edgeOriginSecret = resolve("ATLAS_EDGE_ORIGIN_SECRET");
  const publicUrl = resolve("ATLAS_PUBLIC_URL");
  const authJwtAudiences = resolve("ATLAS_AUTH_JWT_AUDIENCES");

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

  if (!authInternalSecret) {
    log.error("ATLAS_AUTH_INTERNAL_SECRET not found in env files.");
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

  if (!authJwtAudiences) {
    log.error("ATLAS_AUTH_JWT_AUDIENCES not found in env files.");
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
    authInternalSecret,
    authApiKeyIntrospectionUrl,
    authMembershipUrl,
    edgeOriginSecret,
    publicUrl: publicUrl || "https://atlas.rebuildingus.org",
    authJwtAudiences,
    allowedEmails: resolve("ATLAS_AUTH_ALLOWED_EMAILS"),
    resendApiKey: resolve("ATLAS_EMAIL_RESEND_API_KEY"),
  };
}

function readEnvMap(filePath: string): Map<string, string> {
  if (!existsSync(filePath)) return new Map();
  return parseEnvFile(filePath);
}
