#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [, , command] = process.argv;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function optionalEnv(name) {
  return process.env[name]?.trim() ?? "";
}

function runTool(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `${binary} ${args.join(" ")} failed${output ? `\n${output}` : ""}`,
    );
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

function serviceUrl(pathname) {
  return new URL(pathname, requiredEnv("API_URL")).toString();
}

function writeGithubOutput(values) {
  const githubOutput = requiredEnv("GITHUB_OUTPUT");
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(githubOutput, `${lines.join("\n")}\n`);
}

function describeCloudRunService() {
  const payload = runTool("gcloud", [
    "run",
    "services",
    "describe",
    requiredEnv("SERVICE_NAME"),
    "--region",
    requiredEnv("GCP_REGION"),
    "--format=json",
  ]);
  const service = JSON.parse(payload);
  const url = service?.status?.url;
  const revision = service?.status?.latestReadyRevisionName;
  if (typeof url !== "string" || !url) {
    throw new Error("Cloud Run service status did not include status.url.");
  }
  if (typeof revision !== "string" || !revision) {
    throw new Error(
      "Cloud Run service status did not include latestReadyRevisionName.",
    );
  }
  writeGithubOutput({ url, revision });
}

function schedulerJobExists(jobName, region) {
  const result = spawnSync(
    "gcloud",
    ["scheduler", "jobs", "describe", jobName, "--location", region],
    { encoding: "utf8", stdio: "ignore" },
  );
  if (result.error) {
    throw result.error;
  }
  return result.status === 0;
}

function schedulerHeaderFlag(operation) {
  return operation === "update" ? "--update-headers" : "--headers";
}

function ensureSchedulerJob() {
  const jobName = requiredEnv("JOB_NAME");
  const region = requiredEnv("GCP_REGION");
  const operation = schedulerJobExists(jobName, region) ? "update" : "create";
  runTool(
    "gcloud",
    [
      "scheduler",
      "jobs",
      operation,
      "http",
      jobName,
      "--location",
      region,
      "--uri",
      serviceUrl("/api/discovery-runs/scheduled"),
      "--http-method",
      "POST",
      schedulerHeaderFlag(operation),
      `Content-Type=application/json,X-Atlas-Internal-Secret=${requiredEnv(
        "ATLAS_AUTH_INTERNAL_SECRET",
      )}`,
      "--schedule",
      "0 2 * * *",
      "--time-zone",
      "America/Chicago",
      "--attempt-deadline",
      "900s",
      "--quiet",
    ],
    { stdio: "inherit" },
  );
}

function writeDeploySummary() {
  const summaryPath = requiredEnv("GITHUB_STEP_SUMMARY");
  const environmentName = requiredEnv("ATLAS_DEPLOY_MODE");
  const serviceName = requiredEnv("SERVICE_NAME");
  const apiUrl = optionalEnv("API_URL") || "_n/a_";
  const revision = optionalEnv("API_REVISION") || "_n/a_";
  const image = requiredEnv("IMAGE");
  const imageTag = requiredEnv("IMAGE_TAG");
  appendFileSync(
    summaryPath,
    [
      `## Atlas ${environmentName} deploy`,
      "",
      `atlas-web is deployed separately by Vercel; this workflow ships ${serviceName}.`,
      "",
      "| Service | URL | Revision | Image |",
      "| --- | --- | --- | --- |",
      `| ${serviceName} | ${apiUrl} | ${revision} | \`${image}\` |`,
      "",
      `Commit: \`${imageTag}\``,
      "",
    ].join("\n"),
  );
}

switch (command) {
  case "describe":
    describeCloudRunService();
    break;
  case "ensure-scheduler":
    ensureSchedulerJob();
    break;
  case "summary":
    writeDeploySummary();
    break;
  default:
    throw new Error(
      "Usage: cloud-run-release.mjs <describe|ensure-scheduler|summary>",
    );
}
