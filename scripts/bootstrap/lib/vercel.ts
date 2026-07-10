import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { log, note, spinner, text } from "@clack/prompts";
import { runCommand } from "./shell.js";
import { promptOrExit, promptConfirm, logSubline } from "./ui.js";

function assertSafeCliArg(value: string, name: string): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new Error(
      `Invalid ${name}: ${JSON.stringify(value)} — must match [a-zA-Z0-9_.-]+`,
    );
  }
}

export type VercelEnvironment = "production" | "preview" | "development";

export interface VercelEnvKey {
  environment: VercelEnvironment;
  key: string;
}

export interface VercelVar {
  key: string;
  value: string;
  environments: VercelEnvironment[];
}

export interface VercelSyncOptions {
  assumeYes?: boolean;
  cwd?: string;
  targetLabel?: string;
}

interface VercelProjectJson {
  orgId: string;
  projectId: string;
}

interface VercelSyncProject {
  projectId?: string;
  scope: string;
  target: string;
}

interface VercelLinkOptions {
  assumeYes?: boolean;
}

interface VercelLinkTarget {
  team: string;
  project: string;
}

interface DetectedVercelProject {
  team: string;
  url: string;
}

export interface VercelProjectPrompt {
  source: "linked" | "detected";
  projectId?: string;
  projectName: string;
  teamId: string;
  url?: string;
}

interface VercelProjectConfirmation {
  assumeYes: boolean;
  confirmed: boolean;
}

interface VercelEnvListItem {
  key: string;
  target: readonly string[];
}

// ── Linking ──────────────────────────────────────────────────────────────────

export function isVercelLinked(appDir: string): boolean {
  return existsSync(path.join(appDir, ".vercel", "project.json"));
}

export function getVercelScope(appDir: string): string | undefined {
  return readVercelProject(appDir)?.orgId;
}

function readVercelProject(appDir: string): VercelProjectJson | undefined {
  const jsonPath = path.join(appDir, ".vercel", "project.json");
  if (!existsSync(jsonPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(jsonPath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "orgId" in parsed &&
      "projectId" in parsed &&
      typeof parsed.orgId === "string" &&
      typeof parsed.projectId === "string"
    ) {
      return { orgId: parsed.orgId, projectId: parsed.projectId };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// Parse team IDs from `vercel teams ls` text output.
// Output looks like:
//   id                       email / name
// ✔ reasonabletech           Reasonable Tech Company
//   williecubed-projects     Willie's Projects
function listTeamIds(): string[] {
  const result = runCommand("vercel teams ls 2>/dev/null");
  if (!result.ok) return [];
  const teams: string[] = [];
  for (const line of result.stdout.split("\n")) {
    const clean = line.trim().replace(/^[✔✓]\s+/, "");
    const match = /^([a-zA-Z0-9_-]+)\s+/.exec(clean);
    const teamId = match?.[1];
    if (teamId && teamId !== "id" && teamId !== "email") {
      teams.push(teamId);
    }
  }
  return teams;
}

// Search all teams for a project named "atlas". Returns first match.
function findAtlasInTeams(): DetectedVercelProject | undefined {
  for (const team of listTeamIds()) {
    const result = runCommand(
      `vercel project ls --scope "${team}" 2>/dev/null`,
    );
    if (!result.ok) continue;
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim();
      // Match a line starting with "atlas" followed by whitespace
      if (/^atlas(\s|$)/.test(trimmed)) {
        const urlMatch = /https:\/\/\S+/.exec(trimmed);
        return { team, url: urlMatch?.[0] ?? "" };
      }
    }
  }
  return undefined;
}

export function formatVercelProjectPrompt(
  project: VercelProjectPrompt,
): string {
  const lines = [
    `Use this ${project.source} Vercel project?`,
    "",
    `Project: ${project.projectName}`,
  ];
  if (project.projectId) {
    lines.push(`Project ID: ${project.projectId}`);
  }
  lines.push(`Team: ${project.teamId}`);
  if (project.url) {
    lines.push(`URL: ${project.url}`);
  }
  lines.push(
    "",
    "Choose No if this team or project is not the Atlas deployment target.",
  );
  return lines.join("\n");
}

export function formatVercelTeamPromptMessage(): string {
  return [
    "Vercel team or scope",
    "",
    "Choose the Vercel team or personal scope that owns the Atlas project.",
    "1. Open https://vercel.com/dashboard or run `vercel teams ls` in another terminal.",
    "2. Confirm the scope that owns the Atlas project.",
    "3. Pick that exact scope here.",
    "",
    "Bootstrap uses this scope to link app/ and sync environment variables.",
  ].join("\n");
}

export function formatVercelProjectNamePromptMessage(): string {
  return [
    "Vercel project name",
    "",
    "Enter the Vercel project that should receive Atlas environment variables.",
    "1. In the selected Vercel scope, open the project list.",
    "2. Copy the project slug, not the display URL.",
    "3. This is usually `atlas` unless production intentionally uses another project.",
    "",
    "Bootstrap will run `vercel link --project <name>` for app/ next.",
  ].join("\n");
}

export function formatVercelProductionSyncPromptMessage(): string {
  return [
    "Type production to sync Vercel Production env vars",
    "",
    "This will add or update the production environment variables shown above.",
    "1. Confirm the project and team in the Vercel env sync summary.",
    "2. Confirm the keys listed under Production are intended for the live app.",
    "3. Type production only when that target is correct.",
    "",
    "Bootstrap does not delete env vars or rotate secrets during this sync.",
  ].join("\n");
}

export function shouldUseDetectedVercelProject(
  confirmation: VercelProjectConfirmation,
): boolean {
  return confirmation.assumeYes || confirmation.confirmed;
}

async function confirmVercelProject(
  project: VercelProjectPrompt,
  options: VercelLinkOptions,
): Promise<boolean> {
  if (options.assumeYes) {
    return true;
  }
  return shouldUseDetectedVercelProject({
    assumeYes: false,
    confirmed: await promptConfirm(formatVercelProjectPrompt(project), true),
  });
}

async function promptForVercelLink(
  defaults: Partial<VercelLinkTarget> = {},
): Promise<VercelLinkTarget> {
  const teams = listTeamIds();
  let team: string;
  if (teams.length > 0) {
    const { select } = await import("@clack/prompts");
    team = (await promptOrExit(
      select({
        message: formatVercelTeamPromptMessage(),
        options: teams.map((value) => ({ value, label: value })),
        initialValue:
          defaults.team && teams.includes(defaults.team)
            ? defaults.team
            : undefined,
      }),
    )) as string;
  } else {
    team = (await promptOrExit(
      text({
        message: formatVercelTeamPromptMessage(),
        placeholder: defaults.team ?? "team-slug",
      }),
    )) as string;
  }

  const project = (await promptOrExit(
    text({
      message: formatVercelProjectNamePromptMessage(),
      placeholder: defaults.project ?? "atlas",
    }),
  )) as string;

  return { team, project };
}

export async function detectAndLink(
  appDir: string,
  options: VercelLinkOptions = {},
): Promise<void> {
  let team: string;
  let project: string;
  const linked = readVercelProject(appDir);

  if (linked) {
    const confirmed = await confirmVercelProject(
      {
        source: "linked",
        projectId: linked.projectId,
        projectName: "atlas",
        teamId: linked.orgId,
      },
      options,
    );
    if (confirmed) {
      log.success("Vercel project selected");
      logSubline(`Project ID: ${linked.projectId}`);
      logSubline(`Team ID: ${linked.orgId}`);
      return;
    }
    ({ team, project } = await promptForVercelLink({
      team: linked.orgId,
      project: "atlas",
    }));
  } else {
    if (isVercelLinked(appDir)) {
      log.warn("Vercel project link is incomplete — choose the project again.");
    } else {
      log.info("Vercel project not linked — searching across teams...");
    }

    const detected = findAtlasInTeams();
    if (
      detected &&
      (await confirmVercelProject(
        {
          source: "detected",
          projectName: "atlas",
          teamId: detected.team,
          url: detected.url,
        },
        options,
      ))
    ) {
      team = detected.team;
      project = "atlas";
    } else {
      if (!detected) {
        log.warn("Could not detect Vercel project automatically.");
      }
      ({ team, project } = await promptForVercelLink({ project: "atlas" }));
    }
  }

  assertSafeCliArg(team, "team");
  assertSafeCliArg(project, "project");

  const s = spinner();
  s.start(`Linking to ${project} on ${team}...`);

  const result = runCommand(
    `vercel link --scope "${team}" --project "${project}" --yes --cwd "${appDir}" 2>/dev/null`,
  );

  if (result.ok) {
    s.stop(`Linked to ${project} on ${team}`);
  } else {
    s.stop("Vercel link failed");
    log.warn(
      "Could not link automatically. Run `vercel link` in app/ manually.",
    );
  }
}

// ── Env Sync ─────────────────────────────────────────────────────────────────

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

  const confirmed = options.assumeYes ?? (await confirmVercelSync(varsToSync));
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
