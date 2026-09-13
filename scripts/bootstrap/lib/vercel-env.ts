/**
 * Pushing environment variables into a linked Vercel project.
 *
 * Linking a project and syncing its variables are separate jobs with separate
 * failure modes: linking talks to the user about which team and project,
 * syncing previews every change and asks before it touches production.
 */

import { spawnSync } from "node:child_process";
import { note, spinner, text } from "@clack/prompts";
import { promptConfirm, promptOrExit, logSubline } from "./ui.js";
import {
  assertSafeCliArg,
  formatVercelProductionSyncPromptMessage,
  readVercelProject,
  type VercelEnvironment,
  type VercelEnvKey,
  type VercelVar,
} from "./vercel.js";

export interface VercelSyncOptions {
  assumeYes?: boolean;
  cwd?: string;
  targetLabel?: string;
}

interface VercelSyncProject {
  projectId?: string;
  scope: string;
  target: string;
}

interface VercelEnvListItem {
  key: string;
  target: readonly string[];
}

// Set a single env var via vercel CLI, piping value as stdin to avoid shell escaping.
function vercelEnvAdd(
  key: string,
  value: string,
  environment: VercelEnvironment,
  scope: string,
  options: VercelSyncOptions,
): boolean {
  const result = spawnSync(
    "vercel",
    ["env", "add", key, environment, "--scope", scope, "--force"],
    {
      cwd: options.cwd,
      input: value,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    },
  );
  if (result.error) {
    throw new Error(`Failed to spawn vercel CLI: ${result.error.message}`);
  }
  return result.status === 0;
}

function normalizeVercelEnvironment(
  value: string,
): VercelEnvironment | undefined {
  const normalized = value.toLowerCase();
  if (
    normalized === "production" ||
    normalized === "preview" ||
    normalized === "development"
  ) {
    return normalized;
  }
  return undefined;
}

function isVercelEnvListItem(value: unknown): value is VercelEnvListItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "key" in value &&
    "target" in value &&
    typeof value.key === "string" &&
    Array.isArray(value.target) &&
    value.target.every((target) => typeof target === "string")
  );
}

function addVercelEnvKey(
  existing: VercelEnvKey[],
  key: string,
  environment: string,
): void {
  const normalizedEnvironment = normalizeVercelEnvironment(environment);
  if (!normalizedEnvironment) {
    return;
  }
  existing.push({ environment: normalizedEnvironment, key });
}

export function hasVercelEnvKey(
  existingKeys: readonly VercelEnvKey[],
  key: string,
  environment: VercelEnvironment,
): boolean {
  return existingKeys.some(
    (existingKey) =>
      existingKey.key === key && existingKey.environment === environment,
  );
}

// Returns typed key/environment pairs for vars already present on the project.
export function fetchExistingKeys(
  scope: string,
  options: VercelSyncOptions,
): VercelEnvKey[] {
  assertSafeCliArg(scope, "scope");
  const existing: VercelEnvKey[] = [];
  const result = spawnSync("vercel", ["env", "ls", "--scope", scope], {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`Failed to spawn vercel CLI: ${result.error.message}`);
  }
  if (result.status !== 0) {
    return existing;
  }
  const stdout = result.stdout.trim();

  // Try JSON first (supported in recent CLI versions)
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (Array.isArray(parsed) && parsed.every(isVercelEnvListItem)) {
      for (const item of parsed) {
        for (const env of item.target) {
          addVercelEnvKey(existing, item.key, env);
        }
      }
      return existing;
    }
  } catch {
    // Fall through to text parsing
  }

  // Text parsing: "name  value  environments  created"
  // environments column may say "Production", "Preview", "Development"
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith("name") ||
      trimmed.startsWith("Retrieving")
    )
      continue;
    const cols = trimmed.split(/\s{2,}/);
    if (cols.length >= 3) {
      const key = cols[0] ?? "";
      const envCol = cols[2] ?? "";
      // Third column may be comma-separated or single value
      for (const env of envCol.split(/[,\s]+/)) {
        addVercelEnvKey(existing, key, env);
      }
    }
  }

  return existing;
}

interface SyncPreview {
  project?: VercelSyncProject;
  toAdd: VercelVar[];
  toOverwrite: VercelVar[];
}

function environmentLabel(env: VercelEnvironment): string {
  if (env === "production") return "Production";
  if (env === "preview") return "Preview";
  return "Development";
}

function keysForEnvironment(
  vars: VercelVar[],
  env: VercelEnvironment,
): string[] {
  return vars
    .filter((v) => v.environments.includes(env))
    .map((v) => v.key)
    .sort();
}

export function formatVercelSyncPreview(preview: SyncPreview): string {
  const lines: string[] = [];
  if (preview.project) {
    lines.push(`Project: ${preview.project.projectId ?? "linked project"}`);
    lines.push(`Team: ${preview.project.scope}`);
    lines.push(`Target: ${preview.project.target}`);
    lines.push("");
    lines.push("No deletions. No secret rotation.");
    lines.push("");
  }

  for (const env of ["production", "preview", "development"] as const) {
    const toAdd = keysForEnvironment(preview.toAdd, env);
    const toOverwrite = keysForEnvironment(preview.toOverwrite, env);
    if (toAdd.length === 0 && toOverwrite.length === 0) continue;

    lines.push(environmentLabel(env));
    for (const key of toAdd) {
      lines.push(`  add ${key}`);
    }
    for (const key of toOverwrite) {
      lines.push(`  update ${key}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function requiresProductionConfirmation(vars: VercelVar[]): boolean {
  return vars.some((v) => v.environments.includes("production"));
}

export function shouldAutoConfirmVercelSync(
  assumeYes: boolean | undefined,
): boolean {
  return assumeYes === true;
}

function vercelTargetLabel(
  vars: VercelVar[],
  explicitLabel: string | undefined,
): string {
  if (explicitLabel) return explicitLabel;
  const targets = Array.from(
    new Set(vars.flatMap((v) => v.environments.map(environmentLabel))),
  );
  return targets.join(", ");
}

function vercelSyncProject(
  scope: string,
  vars: VercelVar[],
  options: VercelSyncOptions,
): VercelSyncProject {
  const project = options.cwd ? readVercelProject(options.cwd) : undefined;
  return {
    projectId: project?.projectId,
    scope,
    target: vercelTargetLabel(vars, options.targetLabel),
  };
}

async function confirmVercelSync(vars: VercelVar[]): Promise<boolean> {
  if (!requiresProductionConfirmation(vars)) {
    return promptConfirm(
      [
        "Sync these Vercel env vars?",
        "",
        "Bootstrap will add or update the non-production environment variables shown above.",
        "Confirm the project and team in the summary before choosing Yes.",
        "No env vars are deleted and no secrets are rotated.",
      ].join("\n"),
      true,
    );
  }

  const value = await promptOrExit(
    text({
      message: formatVercelProductionSyncPromptMessage(),
      validate: (input) => {
        if ((input ?? "").trim() !== "production") {
          return "Type production to continue.";
        }
      },
    }),
  );
  return value === "production";
}

function buildSyncPreview(
  vars: VercelVar[],
  scope: string,
  options: VercelSyncOptions,
): SyncPreview {
  const existing = fetchExistingKeys(scope, options);
  const toAdd: VercelVar[] = [];
  const toOverwrite: VercelVar[] = [];

  for (const v of vars) {
    const existsInAny = v.environments.some((env) =>
      hasVercelEnvKey(existing, v.key, env),
    );
    if (existsInAny) {
      toOverwrite.push(v);
    } else {
      toAdd.push(v);
    }
  }

  return { toAdd, toOverwrite };
}

export async function syncEnvVars(
  vars: VercelVar[],
  scope: string,
  options: VercelSyncOptions = {},
): Promise<boolean> {
  assertSafeCliArg(scope, "scope");
  if (vars.length === 0) return true;

  const { toAdd, toOverwrite } = buildSyncPreview(vars, scope, options);

  if (toAdd.length === 0 && toOverwrite.length === 0) {
    logSubline("Vercel env vars already up to date");
    return true;
  }

  const varsToSync = [...toAdd, ...toOverwrite];
  note(
    formatVercelSyncPreview({
      project: vercelSyncProject(scope, varsToSync, options),
      toAdd,
      toOverwrite,
    }),
    "Vercel env sync",
  );

  const confirmed = shouldAutoConfirmVercelSync(options.assumeYes)
    ? true
    : await confirmVercelSync(varsToSync);
  if (!confirmed) {
    logSubline("Skipped Vercel env sync");
    return false;
  }

  const s = spinner();
  s.start("Syncing env vars to Vercel...");

  let failed = 0;
  for (const v of [...toAdd, ...toOverwrite]) {
    for (const env of v.environments) {
      if (!vercelEnvAdd(v.key, v.value, env, scope, options)) failed++;
    }
  }

  const total = toAdd.length + toOverwrite.length;
  if (failed === 0) {
    s.stop(`Synced ${total} env var${total === 1 ? "" : "s"} to Vercel`);
    return true;
  } else {
    s.stop(
      `Synced with ${failed} error${failed === 1 ? "" : "s"} — check Vercel dashboard`,
    );
    return false;
  }
}
