import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { log, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../state.js";
import { runCommand, commandOutput } from "../lib/shell.js";
import { type HostedDeployTarget } from "../lib/hosted-target.js";
import { promptConfirm, logSubline } from "../lib/ui.js";
import type { ReadinessState } from "../state.js";
import {
  buildAtlasApiCloudRunEnvVars,
  formatCloudRunEnvVarsFileContent,
  readDeployConfig,
  type DeployConfig,
} from "./deploy-config.js";
import {
  buildAndPushImage,
  buildAtlasApiImageSpec,
  classifyDockerPreflight,
  formatBootstrapImageTag,
  formatDockerDaemonRecovery,
  resolveBuildMode,
} from "./deploy-docker.js";

export function atlasApiServiceName(target: HostedDeployTarget): string {
  return target === "production" ? "atlas-api" : "atlas-api-staging";
}

export async function runDeployPhase(
  projectRoot: string,
  state: ReadinessState,
  doctorMode: boolean,
  target: HostedDeployTarget,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  const serviceName = atlasApiServiceName(target);

  if (doctorMode) {
    log.info("Deploy phase skipped in doctor mode");
    return { success: true, followUpItems: [] };
  }

  const shouldDeploy = await promptConfirm(
    [
      `Deploy ${serviceName} to Cloud Run now (${target})?`,
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
  const config = readDeployConfig(projectRoot, target);

  if (!config) {
    log.error(
      `Missing required configuration for ${target}. Run the infra and database phases first.`,
    );
    followUpItems.push(
      `Complete infrastructure and database setup for ${target} before deploying`,
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
  const apiImageSpec = buildAtlasApiImageSpec({
    projectRoot,
    imageBase: config.imageBase,
    imageTag: formatBootstrapImageTag(config.imageBase),
    serviceName,
  });
  const apiBuilt = await buildAndPushImage(
    apiImageSpec.serviceName,
    apiImageSpec.contextDir,
    apiImageSpec.dockerfilePath,
    apiImageSpec.cloudBuildDockerfilePath,
    apiImageSpec.imageTag,
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
    serviceName,
    apiImageSpec.imageTag,
    config,
    {
      ingress: "all",
      port: 8000,
      envVars: buildAtlasApiCloudRunEnvVars(config),
    },
    followUpItems,
  );

  if (!apiUrl) {
    return { success: false, status: "failed", followUpItems };
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  log.success("Cloud Run deployment complete");
  logSubline(`${serviceName}: ${pc.cyan(apiUrl)}`);
  logSubline(
    pc.dim(
      "atlas-web is auto-deployed by Vercel on push to main; no Cloud Run web service.",
    ),
  );

  return { success: followUpItems.length === 0, followUpItems };
}

// ── Build & Push ──────────────────────────────────────────────────────────────

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
    writeFileSync(
      envFilePath,
      formatCloudRunEnvVarsFileContent(options.envVars),
      "utf8",
    );

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
        `--max-instances=4 ` +
        `--memory=768Mi ` +
        `--cpu=1 ` +
        `--concurrency=8 ` +
        `--timeout=900 ` +
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
