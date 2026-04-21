import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { log, spinner, text } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../lib/types.js";
import { runCommand, commandOutput } from "../lib/shell.js";
import { parseEnvFile } from "../lib/env-file.js";
import { promptOrExit, promptConfirm, logSubline } from "../lib/ui.js";
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
    "Deploy services to Cloud Run now?",
    false,
  );

  if (!shouldDeploy) {
    log.info("Skipped initial deploy. Push to main to trigger automated deployment.");
    return { success: true, followUpItems: [] };
  }

  // ── Read infra values ─────────────────────────────────────────────────────
  const config = readDeployConfig(projectRoot);

  if (!config) {
    log.error(
      "Missing required configuration. Run the infra and database phases first.",
    );
    followUpItems.push("Complete infrastructure and database setup before deploying");
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

  // ── Build & Push Images ───────────────────────────────────────────────────
  const apiImage = `${config.imageBase}/atlas-api:initial`;
  const webImage = `${config.imageBase}/atlas-web:initial`;

  const apiBuilt = await buildAndPushImage(
    projectRoot,
    "atlas-api",
    path.join(projectRoot, "api"),
    apiImage,
    followUpItems,
  );

  if (!apiBuilt) {
    return { success: false, followUpItems };
  }

  const webBuilt = await buildAndPushImage(
    projectRoot,
    "atlas-web",
    path.join(projectRoot, "app"),
    webImage,
    followUpItems,
  );

  if (!webBuilt) {
    return { success: false, followUpItems };
  }

  // ── Deploy atlas-api (internal) ───────────────────────────────────────────
  const apiUrl = await deployService(
    "atlas-api",
    apiImage,
    config,
    {
      ingress: "internal",
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

  // ── Deploy atlas-web (public) ─────────────────────────────────────────────
  const webEnvVars: Record<string, string> = {
    ATLAS_PUBLIC_URL: config.publicUrl,
    ATLAS_AUTH_BASE_PATH: "/api/auth",
    ATLAS_SERVER_API_PROXY_TARGET: apiUrl,
    DATABASE_URL: config.databaseUrl,
    ATLAS_AUTH_INTERNAL_SECRET: config.authInternalSecret,
    ATLAS_AUTH_ALLOWED_EMAILS: config.allowedEmails,
  };

  const webUrl = await deployService(
    "atlas-web",
    webImage,
    config,
    {
      ingress: "all",
      port: 3000,
      envVars: webEnvVars,
    },
    followUpItems,
  );

  if (!webUrl) {
    return { success: false, followUpItems };
  }

  // ── Custom domain mapping ─────────────────────────────────────────────────
  await mapCustomDomain(config, followUpItems);

  // ── Summary ───────────────────────────────────────────────────────────────
  log.success("Cloud Run deployment complete");
  logSubline(`atlas-api: ${pc.cyan(apiUrl)}`);
  logSubline(`atlas-web: ${pc.cyan(webUrl)}`);

  return { success: followUpItems.length === 0, followUpItems };
}

// ── Build & Push ──────────────────────────────────────────────────────────────

async function buildAndPushImage(
  projectRoot: string,
  serviceName: string,
  contextDir: string,
  imageTag: string,
  followUpItems: string[],
): Promise<boolean> {
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

async function deployService(
  serviceName: string,
  imageTag: string,
  config: DeployConfig,
  options: ServiceDeployOptions,
  followUpItems: string[],
): Promise<string | undefined> {
  // Write env vars to a temp file to avoid comma injection with --set-env-vars
  const envFilePath = path.join(tmpdir(), `atlas-${serviceName}-env-${Date.now()}.yaml`);

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

// ── Custom Domain ─────────────────────────────────────────────────────────────

async function mapCustomDomain(
  config: DeployConfig,
  followUpItems: string[],
): Promise<void> {
  const domain = config.publicUrl.replace(/^https?:\/\//, "");
  if (!domain) return;

  const shouldMap = await promptConfirm(
    `Map custom domain (${domain}) to atlas-web?`,
    false,
  );

  if (!shouldMap) return;

  const s = spinner();
  s.start(`Mapping domain ${domain}...`);

  const mapResult = runCommand(
    `gcloud run domain-mappings create ` +
      `--service=atlas-web ` +
      `--domain="${domain}" ` +
      `--region="${config.region}" ` +
      `--quiet 2>/dev/null`,
  );

  if (!mapResult.ok) {
    s.stop("Domain mapping may already exist or require DNS verification");
  } else {
    s.stop(`Domain mapping created for ${domain}`);
  }

  // Cloudflare DNS auto-configuration
  const hasWrangler = runCommand("command -v wrangler").ok;

  if (hasWrangler) {
    await configureCloudflare(domain, followUpItems);
  } else {
    logSubline("Add this DNS record to your domain:");
    logSubline(`  Type:  CNAME`);
    logSubline(`  Name:  ${domain}`);
    logSubline(`  Value: ghs.googlehosted.com.`);
    logSubline("");
    logSubline(pc.dim("Tip: Install wrangler (pnpm add -g wrangler) to auto-configure Cloudflare DNS."));
    followUpItems.push(`Add CNAME record for ${domain} pointing to ghs.googlehosted.com`);
  }
}

async function configureCloudflare(
  domain: string,
  followUpItems: string[],
): Promise<void> {
  const shouldConfigure = await promptConfirm(
    "Configure DNS via Cloudflare (wrangler)?",
    true,
  );

  if (!shouldConfigure) {
    followUpItems.push(`Add CNAME record for ${domain} pointing to ghs.googlehosted.com`);
    return;
  }

  // Extract root domain and subdomain
  const parts = domain.split(".");
  const rootDomain = parts.slice(-2).join(".");
  const subdomain = parts.slice(0, -2).join(".");

  const s = spinner();
  s.start(`Detecting Cloudflare zone for ${rootDomain}...`);

  const zoneResult = runCommand(
    `wrangler dns list-zones 2>/dev/null`,
  );

  if (!zoneResult.ok) {
    s.stop("Failed to query Cloudflare zones");
    followUpItems.push(`Add CNAME record for ${domain} pointing to ghs.googlehosted.com`);
    return;
  }

  // Parse zone ID from output
  const zoneLine = zoneResult.stdout
    .split("\n")
    .find((line) => line.includes(rootDomain));

  if (!zoneLine) {
    s.stop(`Could not find Cloudflare zone for ${rootDomain}`);
    logSubline("Add this DNS record manually:");
    logSubline(`  Type:  CNAME`);
    logSubline(`  Name:  ${subdomain || "@"}`);
    logSubline(`  Value: ghs.googlehosted.com.`);
    followUpItems.push(`Add CNAME record for ${domain} pointing to ghs.googlehosted.com`);
    return;
  }

  const zoneId = zoneLine.split(/\s+/)[0];
  s.stop(`Found Cloudflare zone: ${rootDomain} (${zoneId})`);

  // Check for existing record
  const existingResult = runCommand(
    `wrangler dns list "${zoneId}" --name="${domain}" 2>/dev/null`,
  );

  if (existingResult.ok && existingResult.stdout.includes("CNAME")) {
    log.warn(`DNS record already exists for ${domain} — skipping`);
    return;
  }

  // Create CNAME record
  const createSpinner = spinner();
  createSpinner.start(`Creating CNAME record: ${domain} -> ghs.googlehosted.com`);

  const createResult = runCommand(
    `wrangler dns create "${zoneId}" ` +
      `--type=CNAME ` +
      `--name="${subdomain}" ` +
      `--content="ghs.googlehosted.com" ` +
      `--proxied=false 2>/dev/null`,
  );

  if (createResult.ok) {
    createSpinner.stop("Cloudflare DNS record created");
  } else {
    createSpinner.stop("Failed to create DNS record");
    followUpItems.push(`Add CNAME record for ${domain} pointing to ghs.googlehosted.com`);
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
