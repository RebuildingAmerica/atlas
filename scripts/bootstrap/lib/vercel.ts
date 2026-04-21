import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { log, spinner } from "@clack/prompts";
import pc from "picocolors";
import { runCommand } from "./shell.js";
import { promptOrExit, promptConfirm, logSubline } from "./ui.js";

export type VercelEnvironment = "production" | "preview" | "development";

export interface VercelVar {
  key: string;
  value: string;
  environments: VercelEnvironment[];
}

interface VercelProjectJson {
  orgId: string;
  projectId: string;
}

// ── Linking ──────────────────────────────────────────────────────────────────

export function isVercelLinked(appDir: string): boolean {
  return existsSync(path.join(appDir, ".vercel", "project.json"));
}

export function getVercelScope(appDir: string): string | undefined {
  const jsonPath = path.join(appDir, ".vercel", "project.json");
  if (!existsSync(jsonPath)) return undefined;
  try {
    const data = JSON.parse(
      readFileSync(jsonPath, "utf8"),
    ) as VercelProjectJson;
    return data.orgId;
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
function findAtlasInTeams(): { team: string; url: string } | undefined {
  for (const team of listTeamIds()) {
    const result = runCommand(
      `vercel project ls --scope "${team}" 2>/dev/null`,
    );
    if (!result.ok) continue;
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim();
      // Match a line starting with "atlas" followed by whitespace
      if (/^atlas\s/.test(trimmed)) {
        const urlMatch = /https:\/\/\S+/.exec(trimmed);
        return { team, url: urlMatch?.[0] ?? "" };
      }
    }
  }
  return undefined;
}

export async function detectAndLink(appDir: string): Promise<void> {
  if (isVercelLinked(appDir)) {
    const scope = getVercelScope(appDir);
    logSubline(`Vercel: already linked${scope ? ` (${scope})` : ""}`);
    return;
  }

  log.info("Vercel project not linked — searching across teams...");

  const detected = findAtlasInTeams();

  let team: string;
  let project: string;

  if (detected) {
    const confirmed = await promptConfirm(
      `Link app/ to 'atlas' on '${detected.team}'${detected.url ? ` (${detected.url})` : ""}?`,
      true,
    );
    if (confirmed) {
      team = detected.team;
      project = "atlas";
    } else {
      const { text } = await import("@clack/prompts");
      team = (await promptOrExit(
        text({
          message: "Vercel scope/team",
          placeholder: "williecubed-projects",
        }),
      )) as string;
      project = (await promptOrExit(
        text({ message: "Vercel project name", placeholder: "atlas" }),
      )) as string;
    }
  } else {
    log.warn("Could not detect Vercel project automatically.");
    const { text } = await import("@clack/prompts");
    team = (await promptOrExit(
      text({
        message: "Vercel scope/team",
        placeholder: "williecubed-projects",
      }),
    )) as string;
    project = (await promptOrExit(
      text({ message: "Vercel project name", placeholder: "atlas" }),
    )) as string;
  }

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
): boolean {
  const shell = process.env.SHELL ?? "sh";
  const result = spawnSync(
    shell,
    [
      "-c",
      `vercel env add "${key}" "${environment}" --scope "${scope}" --force 2>/dev/null`,
    ],
    { input: value, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" },
  );
  return result.status === 0;
}

// Returns a Set of "KEY:environment" strings for vars already present on the project.
function fetchExistingKeys(scope: string): Set<string> {
  const existing = new Set<string>();
  const result = runCommand(`vercel env ls --scope "${scope}" 2>/dev/null`);
  if (!result.ok) return existing;

  // Try JSON first (supported in recent CLI versions)
  try {
    const parsed = JSON.parse(result.stdout) as {
      key: string;
      target: string[];
    }[];
    for (const item of parsed) {
      for (const env of item.target) {
        existing.add(`${item.key}:${env.toLowerCase()}`);
      }
    }
    return existing;
  } catch {
    // Fall through to text parsing
  }

  // Text parsing: "name  value  environments  created"
  // environments column may say "Production", "Preview", "Development"
  for (const line of result.stdout.split("\n")) {
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
        existing.add(`${key}:${env.toLowerCase()}`);
      }
    }
  }

  return existing;
}

interface SyncPreview {
  toAdd: VercelVar[];
  toOverwrite: VercelVar[];
}

function buildSyncPreview(vars: VercelVar[], scope: string): SyncPreview {
  const existing = fetchExistingKeys(scope);
  const toAdd: VercelVar[] = [];
  const toOverwrite: VercelVar[] = [];

  for (const v of vars) {
    const existsInAny = v.environments.some((env) =>
      existing.has(`${v.key}:${env}`),
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
): Promise<void> {
  if (vars.length === 0) return;

  const { toAdd, toOverwrite } = buildSyncPreview(vars, scope);

  if (toAdd.length === 0 && toOverwrite.length === 0) {
    logSubline("Vercel env vars already up to date");
    return;
  }

  // Print preview table
  const lines: string[] = [];
  for (const v of toAdd) {
    lines.push(
      `  ${pc.green("+")} ${v.key.padEnd(45)} ${v.environments.join(", ")}  (new)`,
    );
  }
  for (const v of toOverwrite) {
    lines.push(
      `  ${pc.yellow("~")} ${v.key.padEnd(45)} ${v.environments.join(", ")}  (overwrite)`,
    );
  }
  log.message(lines.join("\n"));

  const confirmed = await promptConfirm("Apply these changes to Vercel?", true);
  if (!confirmed) {
    logSubline("Skipped Vercel env sync");
    return;
  }

  const s = spinner();
  s.start("Syncing env vars to Vercel...");

  let failed = 0;
  for (const v of [...toAdd, ...toOverwrite]) {
    for (const env of v.environments) {
      if (!vercelEnvAdd(v.key, v.value, env, scope)) failed++;
    }
  }

  const total = toAdd.length + toOverwrite.length;
  if (failed === 0) {
    s.stop(`Synced ${total} env var${total === 1 ? "" : "s"} to Vercel`);
  } else {
    s.stop(
      `Synced with ${failed} error${failed === 1 ? "" : "s"} — check Vercel dashboard`,
    );
  }
}
