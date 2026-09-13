/**
 * Building and pushing the Atlas API image, locally or through Cloud Build.
 *
 * Getting an image is where the deploy phase fails most: no Docker daemon, a
 * daemon that needs starting, or a Dockerfile whose COPY sources sit outside
 * the build context.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { log, spinner } from "@clack/prompts";
import { runCommand, commandOutput, type CommandResult } from "../lib/shell.js";
import { promptConfirm } from "../lib/ui.js";
import {
  formatCloudBuildSourceAccessFollowUp,
  isGcloudReauthenticationFailure,
  parseCloudBuildSourceAccessFailure,
  recoverCloudBuildSourceAccess,
  recoverGcloudAuthentication,
  type CloudBuildRecoveryOptions,
} from "./deploy-recovery.js";

export interface DockerPreflight {
  status: "ready" | "blocked";
  reason?: "daemon-unavailable" | "unknown";
}

export interface DockerBuildPlanOptions {
  projectRoot: string;
  serviceRoot: string;
  dockerfileName?: string;
  dockerfileContent?: string;
}

export interface DockerBuildPlan {
  contextDir: string;
  dockerfilePath: string;
  cloudBuildDockerfilePath: string;
}

export interface CloudBuildDockerStep {
  name: string;
  env: string[];
  args: string[];
}

export interface CloudBuildDockerConfig {
  steps: CloudBuildDockerStep[];
  images: string[];
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

export async function resolveBuildMode(
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

export async function buildAndPushImage(
  serviceName: string,
  contextDir: string,
  dockerfilePath: string,
  cloudBuildDockerfilePath: string,
  imageTag: string,
  buildMode: BuildMode,
  followUpItems: string[],
): Promise<boolean> {
  if (buildMode === "cloud-build") {
    return await buildAndPushImageWithCloudBuild(
      serviceName,
      contextDir,
      cloudBuildDockerfilePath,
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
  dockerfilePathForContext: string,
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
    formatCloudBuildDockerConfig(dockerfilePathForContext, imageTag),
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
        dockerfilePathForContext,
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
        dockerfilePathForContext,
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

export function resolveDockerBuildPlan(
  options: DockerBuildPlanOptions,
): DockerBuildPlan {
  const dockerfileName = options.dockerfileName ?? "Dockerfile";
  const serviceDir = path.join(options.projectRoot, options.serviceRoot);
  const dockerfilePath = path.join(serviceDir, dockerfileName);
  const dockerfileContent =
    options.dockerfileContent ?? readFileSync(dockerfilePath, "utf8");
  const copySources = parseDockerCopySources(dockerfileContent);
  const contextDir = copySources.some((source) =>
    copySourceNeedsProjectRoot(source, options.projectRoot, serviceDir),
  )
    ? options.projectRoot
    : serviceDir;

  return {
    contextDir,
    dockerfilePath,
    cloudBuildDockerfilePath: path.relative(contextDir, dockerfilePath),
  };
}

function parseDockerCopySources(dockerfileContent: string): string[] {
  return dockerfileContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(COPY|ADD)\s/i.test(line))
    .filter((line) => !/\s--from(?:=|\s)/i.test(line))
    .flatMap((line) => parseDockerCopyInstructionSources(line));
}

function parseDockerCopyInstructionSources(line: string): string[] {
  const instruction = /^(?:COPY|ADD)\s+/i.exec(line);
  if (!instruction) return [];
  const args = line.slice(instruction[0].length).trim();
  const flaglessArgs = args.replace(/^(?:--[^\s]+\s+)*/, "");
  if (flaglessArgs.startsWith("[")) {
    const parsed = JSON.parse(flaglessArgs) as unknown;
    if (
      !Array.isArray(parsed) ||
      !parsed.every((item): item is string => typeof item === "string")
    ) {
      return [];
    }
    return parsed.slice(0, -1);
  }

  const parts = flaglessArgs.split(/\s+/).filter(Boolean);
  return parts.slice(0, -1);
}

function copySourceNeedsProjectRoot(
  source: string,
  projectRoot: string,
  serviceDir: string,
): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
    return false;
  }

  const serviceRootName = path.basename(serviceDir);
  const firstSegment = source.split(/[\\/]/)[0];
  if (firstSegment === serviceRootName) {
    return true;
  }

  const projectSource = path.join(projectRoot, source);
  const serviceSource = path.join(serviceDir, source);
  return existsSync(projectSource) && !existsSync(serviceSource);
}

export function formatDockerBuildCommand(
  contextDir: string,
  dockerfilePath: string,
  imageTag: string,
): string {
  const resolvedDockerfile = path.isAbsolute(dockerfilePath)
    ? dockerfilePath
    : path.join(contextDir, dockerfilePath);
  return `docker build --platform="${CLOUD_RUN_IMAGE_PLATFORM}" --file="${resolvedDockerfile}" -t "${imageTag}" "${contextDir}"`;
}

export function formatCloudBuildSubmitCommand(
  contextDir: string,
  configPath: string,
): string {
  return `gcloud builds submit "${contextDir}" --config="${configPath}" --quiet`;
}

export function buildCloudBuildDockerConfig(
  dockerfilePath: string,
  imageTag: string,
): CloudBuildDockerConfig {
  return {
    steps: [
      {
        name: "gcr.io/cloud-builders/docker",
        // The Atlas Dockerfiles use `RUN --mount=type=cache` so dependency
        // downloads survive between builds. The Cloud Build docker builder
        // defaults to the legacy engine, which rejects `--mount` outright, so
        // BuildKit has to be requested explicitly here. Locally this is
        // implicit -- Docker Desktop enables BuildKit by default -- which is
        // why only the Cloud Build fallback ever hit it.
        env: ["DOCKER_BUILDKIT=1"],
        args: [
          "build",
          "--platform",
          CLOUD_RUN_IMAGE_PLATFORM,
          "--file",
          dockerfilePath,
          "-t",
          imageTag,
          ".",
        ],
      },
    ],
    images: [imageTag],
  };
}

export function formatCloudBuildDockerConfig(
  dockerfilePath: string,
  imageTag: string,
): string {
  return JSON.stringify(
    buildCloudBuildDockerConfig(dockerfilePath, imageTag),
    null,
    2,
  );
}

export interface AtlasApiImageSpecOptions {
  projectRoot: string;
  imageBase: string;
  imageTag: string;
  serviceName: string;
  dockerfileContent?: string;
}

export interface AtlasApiImageSpec extends DockerBuildPlan {
  serviceName: string;
  imageTag: string;
}

export function buildAtlasApiImageSpec(
  options: AtlasApiImageSpecOptions,
): AtlasApiImageSpec {
  const buildPlan = resolveDockerBuildPlan({
    projectRoot: options.projectRoot,
    serviceRoot: "api",
    dockerfileContent: options.dockerfileContent,
  });

  return {
    serviceName: options.serviceName,
    contextDir: buildPlan.contextDir,
    dockerfilePath: buildPlan.dockerfilePath,
    cloudBuildDockerfilePath: buildPlan.cloudBuildDockerfilePath,
    imageTag: options.imageTag,
  };
}

export function formatBootstrapImageTag(
  imageBase: string,
  date: Date = new Date(),
): string {
  return `${imageBase}/atlas-api:bootstrap-${date
    .toISOString()
    .replaceAll(/[^0-9]/g, "")
    .slice(0, 14)}`;
}

const CLOUD_RUN_IMAGE_PLATFORM = "linux/amd64";

const DEFAULT_CLOUD_BUILD_RECOVERY_OPTIONS: CloudBuildRecoveryOptions = {
  allowAuthRecovery: true,
  allowSourceAccessRecovery: true,
};

type BuildMode = "local-docker" | "cloud-build";
