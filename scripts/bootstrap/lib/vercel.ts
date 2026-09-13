import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { log, spinner, text } from "@clack/prompts";
import { runCommand } from "./shell.js";
import { promptOrExit, promptConfirm, logSubline } from "./ui.js";

export function assertSafeCliArg(value: string, name: string): void {
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

interface VercelProjectJson {
  orgId: string;
  projectId: string;
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

// ── Linking ──────────────────────────────────────────────────────────────────

export function isVercelLinked(appDir: string): boolean {
  return existsSync(path.join(appDir, ".vercel", "project.json"));
}

export function getVercelScope(appDir: string): string | undefined {
  return readVercelProject(appDir)?.orgId;
}

export function readVercelProject(
  appDir: string,
): VercelProjectJson | undefined {
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
