#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildArtifactCleanupPolicy,
  evaluateCloudRunCostPosture,
  evaluateRepositoryCostPosture,
  summarizeCostPosture,
} from "./cloud-cost-policy.mjs";

const [, , command] = process.argv;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
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

function parseImageRegistry(registry) {
  const parts = registry.split("/");
  if (parts.length < 3) {
    throw new Error(
      "IMAGE_REGISTRY must look like <region>-docker.pkg.dev/<project>/<repo>.",
    );
  }
  return {
    project: parts[1],
    repository: parts[2],
  };
}

function writeCleanupPolicyFile() {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-artifact-cleanup-"));
  const policyPath = path.join(dir, "policy.json");
  writeFileSync(
    policyPath,
    `${JSON.stringify(buildArtifactCleanupPolicy(), null, 2)}\n`,
  );
  return policyPath;
}

function applyArtifactCleanupPolicy({ imageRegistry, region }) {
  const { project, repository } = parseImageRegistry(imageRegistry);
  const policyPath = writeCleanupPolicyFile();
  runTool(
    "gcloud",
    [
      "artifacts",
      "repositories",
      "set-cleanup-policies",
      repository,
      "--location",
      region,
      "--project",
      project,
      "--policy",
      policyPath,
      "--quiet",
    ],
    { stdio: "inherit" },
  );
  return { project, repository };
}

function describeRepository({ imageRegistry, region }) {
  const { project, repository } = parseImageRegistry(imageRegistry);
  const payload = runTool("gcloud", [
    "artifacts",
    "repositories",
    "describe",
    repository,
    "--location",
    region,
    "--project",
    project,
    "--format=json",
  ]);
  return JSON.parse(payload);
}

function describeCloudRunService({ region, serviceName }) {
  const payload = runTool("gcloud", [
    "run",
    "services",
    "describe",
    serviceName,
    "--region",
    region,
    "--format=json",
  ]);
  return JSON.parse(payload);
}

function printSummary({ cloudRunPosture, repositoryPosture, summary }) {
  const lines = [
    `Cloud cost preflight ${summary.status === "pass" ? "passed" : "blocked"}.`,
    "",
    `Cloud Run: ${cloudRunPosture.status}`,
    `Artifact Registry: ${repositoryPosture.status}`,
  ];
  if (summary.blockers.length > 0) {
    lines.push(
      "",
      "Blockers:",
      ...summary.blockers.map((blocker) => `- ${blocker}`),
    );
  }
  if (summary.warnings.length > 0) {
    lines.push(
      "",
      "Warnings:",
      ...summary.warnings.map((warning) => `- ${warning}`),
    );
  }
  console.log(lines.join("\n"));
}

function check() {
  const region = requiredEnv("GCP_REGION");
  const imageRegistry = requiredEnv("IMAGE_REGISTRY");
  const serviceName = requiredEnv("SERVICE_NAME");

  const cloudRunPosture = evaluateCloudRunCostPosture(
    describeCloudRunService({ region, serviceName }),
  );
  const repositoryPosture = evaluateRepositoryCostPosture(
    describeRepository({ imageRegistry, region }),
  );
  const summary = summarizeCostPosture([cloudRunPosture, repositoryPosture]);

  printSummary({ cloudRunPosture, repositoryPosture, summary });
  if (summary.status === "block") {
    process.exitCode = 1;
  }
}

function applyCleanupPolicy() {
  const region = requiredEnv("GCP_REGION");
  const imageRegistry = requiredEnv("IMAGE_REGISTRY");
  const { project, repository } = applyArtifactCleanupPolicy({
    imageRegistry,
    region,
  });
  console.log(
    `Applied Artifact Registry cleanup policy to ${project}/${repository}.`,
  );
}

switch (command) {
  case "apply-cleanup-policy":
    applyCleanupPolicy();
    break;
  case "check":
    check();
    break;
  default:
    throw new Error(
      "Usage: cloud-cost-preflight.mjs <check|apply-cleanup-policy>",
    );
}
