import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { log, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../lib/types.js";
import { runCommand, commandOutput } from "../lib/shell.js";
import { parseEnvFile } from "../lib/env-file.js";
import { promptConfirm, logSubline } from "../lib/ui.js";
import type { ReadinessState } from "../state.js";

const REPO_NAME = "atlas-images";

interface DeployConfig {
  projectId: string;
  region: string;
  imageBase: string;
  databaseUrl: string;
  anthropicApiKey: string;
  authInternalSecret: string;
  publicUrl: string;
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
    "Deploy atlas-api to Cloud Run now? (atlas-web ships via Vercel auto-deploy.)",
    false,
  );

  if (!shouldDeploy) {
    log.info(
      "Skipped initial deploy. Push to main to trigger automated deployment.",
    );
    return { success: true, followUpItems: [] };
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
    return { success: false, followUpItems };
  }

  // ── Configure Docker auth ─────────────────────────────────────────────────
  const s = spinner();
  s.start("Configuring Docker for Artifact Registry...");

  const dockerAuthResult = runCommand(
    `gcloud auth configure-docker "${config.region}-docker.pkg.dev" --quiet`,
  );

  if (!dockerAuthResult.ok) {
    s.stop("Failed to configure Docker authentication");
    log.error(commandOutput(dockerAuthResult));
    followUpItems.push("Configure Docker auth for Artifact Registry");
    return { success: false, followUpItems };
  }

  s.stop("Docker configured for Artifact Registry");

  // ── Build & Push API image ────────────────────────────────────────────────
  const apiImage = `${config.imageBase}/atlas-api:initial`;
  const apiBuilt = buildAndPushImage(
    projectRoot,
    "atlas-api",
    path.join(projectRoot, "api"),
    apiImage,
    followUpItems,
  );

  if (!apiBuilt) {
    return { success: false, followUpItems };
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
        DATABASE_URL: config.databaseUrl,
        ANTHROPIC_API_KEY: config.anthropicApiKey,
        ATLAS_AUTH_INTERNAL_SECRET: config.authInternalSecret,
        ATLAS_PUBLIC_URL: config.publicUrl,
      },
    },
    followUpItems,
  );

  if (!apiUrl) {
    return { success: false, followUpItems };
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

// ── Build & Push ──────────────────────────────────────────────────────────────

function buildAndPushImage(
  projectRoot: string,
  serviceName: string,
  contextDir: string,
  imageTag: string,
  followUpItems: string[],
): boolean {
  // Build
  const buildSpinner = spinner();
  buildSpinner.start(`Building ${serviceName}...`);

  const buildResult = runCommand(
    `docker build -t "${imageTag}" "${contextDir}"`,
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
  const authInternalSecret = resolve("ATLAS_AUTH_INTERNAL_SECRET");
  const publicUrl = resolve("ATLAS_PUBLIC_URL");

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

  const imageBase = `${region}-docker.pkg.dev/${projectId}/${REPO_NAME}`;

  return {
    projectId,
    region,
    imageBase,
    databaseUrl,
    anthropicApiKey,
    authInternalSecret,
    publicUrl: publicUrl || "https://atlas.rebuildingus.org",
    allowedEmails: resolve("ATLAS_AUTH_ALLOWED_EMAILS"),
    resendApiKey: resolve("ATLAS_EMAIL_RESEND_API_KEY"),
  };
}

function readEnvMap(filePath: string): Map<string, string> {
  if (!existsSync(filePath)) return new Map();
  return parseEnvFile(filePath);
}
