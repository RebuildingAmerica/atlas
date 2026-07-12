#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TRUE_OUTPUTS = {
  full: true,
  quality: true,
  python_tests: true,
  app_tests: true,
  acceptance: true,
  contract: true,
  openapi: true,
  docs: true,
  compose: true,
  secrets_scan: true,
  deploy_scripts: true,
  staging_api_deploy: true,
  hosted_smoke: true,
  use_affected: false,
};

const FALSE_OUTPUTS = {
  full: false,
  quality: false,
  python_tests: false,
  app_tests: false,
  acceptance: false,
  contract: false,
  openapi: false,
  docs: false,
  compose: false,
  secrets_scan: false,
  deploy_scripts: false,
  staging_api_deploy: false,
  hosted_smoke: false,
  use_affected: false,
};

const GLOBAL_PATHS = [
  /^\.github\//,
  /^scripts\/ci\//,
  /^scripts\/validate-turbo-selectors\.mjs$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^turbo\.json$/,
  /^\.nvmrc$/,
  /^\.env(?:\.production)?\.example$/,
  /^api\/uv\.lock$/,
  /^api\/pyproject\.toml$/,
  /^libs\/shared\/pyproject\.toml$/,
  /^libs\/discovery-engine\/pyproject\.toml$/,
];

const API_PATHS = [
  /^api\//,
  /^libs\/shared\//,
  /^libs\/discovery-engine\//,
  /^openapi\//,
];

const APP_PATHS = [
  /^app\//,
  /^packages\/entity-widgets\//,
  /^packages\/entity-widgets-mcp\//,
];

const SCOUT_PATHS = [
  /^scout\//,
  /^libs\/shared\//,
  /^libs\/discovery-engine\//,
];

const DOCS_PATHS = [/^docs\//, /^mintlify\//, /^README\.md$/, /^AGENTS\.md$/];

const COMPOSE_PATHS = [
  /^compose\.ya?ml$/,
  /^deploy\/Caddyfile$/,
  /^\.env(?:\.production)?\.example$/,
];

const DEPLOY_PATHS = [
  /^api\/Dockerfile$/,
  /^api\/\.dockerignore$/,
  /^\.dockerignore$/,
  /^scripts\/deploy\//,
  /^config\.openstatus\.ya?ml$/,
];

function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

function normalizeFiles(files) {
  return [...new Set(files.map((file) => file.trim()).filter(Boolean))]
    .map((file) => file.replace(/^\.\//, ""))
    .sort();
}

function isAllZeroSha(value) {
  return Boolean(value) && /^0+$/.test(value);
}

function isForcedFullRun(context) {
  if (context.profile === "production") return "production release";
  if (context.eventName === "schedule") return "scheduled CI";
  if (context.eventName === "workflow_dispatch") return "manual workflow run";
  if (context.ref?.startsWith("refs/tags/v")) return "release tag";
  if (isAllZeroSha(context.beforeSha)) return "new branch or missing base SHA";
  return "";
}

export function classifyChangedFiles(files, context = {}) {
  const normalized = normalizeFiles(files);
  const forcedReason = isForcedFullRun(context);

  if (forcedReason) {
    return {
      reason: forcedReason,
      files: normalized,
      outputs: { ...TRUE_OUTPUTS },
    };
  }

  if (normalized.length === 0) {
    return {
      reason: "no changed files detected",
      files: normalized,
      outputs: { ...FALSE_OUTPUTS },
    };
  }

  const touchesGlobal = normalized.some((file) =>
    matchesAny(file, GLOBAL_PATHS),
  );
  if (touchesGlobal) {
    return {
      reason: "global CI, dependency, or toolchain file changed",
      files: normalized,
      outputs: { ...TRUE_OUTPUTS },
    };
  }

  const touchesApi = normalized.some((file) => matchesAny(file, API_PATHS));
  const touchesApp = normalized.some((file) => matchesAny(file, APP_PATHS));
  const touchesScout = normalized.some((file) => matchesAny(file, SCOUT_PATHS));
  const touchesDocs = normalized.some((file) => matchesAny(file, DOCS_PATHS));
  const touchesCompose = normalized.some((file) =>
    matchesAny(file, COMPOSE_PATHS),
  );
  const touchesDeploy = normalized.some((file) =>
    matchesAny(file, DEPLOY_PATHS),
  );

  const outputs = {
    ...FALSE_OUTPUTS,
    full: false,
    quality: touchesApi || touchesApp || touchesScout || touchesDeploy,
    python_tests: touchesApi || touchesScout,
    app_tests: touchesApp,
    acceptance: touchesApi || touchesApp || touchesDeploy,
    contract: touchesApi,
    openapi: touchesApi,
    docs: touchesDocs,
    compose: touchesCompose,
    secrets_scan: true,
    deploy_scripts: touchesDeploy,
    staging_api_deploy: touchesApi || touchesDeploy,
    hosted_smoke: touchesApi || touchesApp || touchesDeploy,
    use_affected:
      context.eventName === "pull_request" &&
      (touchesApi || touchesApp || touchesScout || touchesDeploy),
  };

  return {
    reason: "classified changed paths",
    files: normalized,
    outputs,
  };
}

function readChangedFilesFromGit(context) {
  const headSha = context.headSha || "HEAD";
  let baseSha = "";

  if (context.eventName === "pull_request") {
    baseSha = context.baseSha;
  } else if (context.eventName === "push") {
    baseSha = context.beforeSha;
  }

  if (!baseSha || isAllZeroSha(baseSha)) {
    return [];
  }

  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMRTUXB", baseSha, headSha],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "").trim());
  }

  return result.stdout.split("\n");
}

function parseContextFromEnv(env) {
  return {
    profile: env.ATLAS_CI_PROFILE || "",
    eventName: env.GITHUB_EVENT_NAME || "",
    ref: env.GITHUB_REF || "",
    baseSha: env.ATLAS_BASE_SHA || env.GITHUB_BASE_SHA || "",
    beforeSha: env.ATLAS_BEFORE_SHA || "",
    headSha: env.ATLAS_HEAD_SHA || env.GITHUB_SHA || "HEAD",
  };
}

function writeOutputs(outputs, env) {
  if (!env.GITHUB_OUTPUT) return;

  const lines = Object.entries(outputs).map(
    ([key, value]) => `${key}=${value ? "true" : "false"}`,
  );
  appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function writeSummary(result, env) {
  const outputRows = Object.entries(result.outputs)
    .map(([key, value]) => `| \`${key}\` | ${value ? "yes" : "no"} |`)
    .join("\n");

  const files = result.files.length
    ? result.files.map((file) => `- \`${file}\``).join("\n")
    : "- No changed files detected.";

  const markdown = [
    "### CI change classification",
    "",
    `Reason: ${result.reason}`,
    "",
    "| Output | Enabled |",
    "| --- | --- |",
    outputRows,
    "",
    "<details><summary>Changed files</summary>",
    "",
    files,
    "",
    "</details>",
    "",
  ].join("\n");

  console.log(markdown);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  }
}

function main() {
  const context = parseContextFromEnv(process.env);
  const files = process.env.ATLAS_CHANGED_FILES
    ? process.env.ATLAS_CHANGED_FILES.split("\n")
    : readChangedFilesFromGit(context);
  const result = classifyChangedFiles(files, context);

  writeOutputs(result.outputs, process.env);
  writeSummary(result, process.env);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
