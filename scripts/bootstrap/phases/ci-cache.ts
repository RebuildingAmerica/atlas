import { spawnSync } from "node:child_process";
import { log, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../lib/types.js";
import { commandOutput, runCommand } from "../lib/shell.js";
import { logSubline, promptConfirm, promptOrExit } from "../lib/ui.js";
import { getVercelScope, isVercelLinked } from "../lib/vercel.js";

const SECRET_NAME = "TURBO_TOKEN"; // pragma: allowlist secret
const VAR_NAME = "TURBO_TEAM";
const TOKEN_NAME = "atlas-ci-remote-cache";

interface RepoIdentity {
  nameWithOwner: string;
}

interface VercelTeam {
  id: string;
  slug: string;
  name: string;
  current?: boolean;
}

interface TeamLookup {
  teams: VercelTeam[];
  linked?: VercelTeam;
}

export async function runCiCachePhase(
  projectRoot: string,
  doctorMode: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];

  if (!runCommand("command -v gh").ok) {
    log.warn(
      "GitHub CLI (gh) not installed. Run install/auth phases first or `brew install gh`.",
    );
    followUpItems.push(
      "Install GitHub CLI to wire TURBO_TOKEN/TURBO_TEAM into Actions",
    );
    return { success: false, followUpItems };
  }

  if (!runCommand("gh auth status 2>&1 | grep -q 'Logged in'").ok) {
    log.warn("GitHub CLI is not authenticated. Run `gh auth login` and retry.");
    followUpItems.push("Run `gh auth login`, then re-run bootstrap --ci-cache");
    return { success: false, followUpItems };
  }

  if (!runCommand("command -v vercel").ok) {
    log.warn(
      "Vercel CLI not installed. Run `pnpm add -g vercel` or `brew install vercel-cli`, then retry.",
    );
    followUpItems.push(
      "Install Vercel CLI so the bootstrap can mint TURBO_TOKEN automatically",
    );
    return { success: false, followUpItems };
  }

  if (!runCommand("vercel whoami 2>/dev/null").ok) {
    log.warn("Vercel CLI is not authenticated. Run `vercel login` and retry.");
    followUpItems.push("Run `vercel login`, then re-run bootstrap --ci-cache");
    return { success: false, followUpItems };
  }

  const repo = detectRepo();
  if (!repo) {
    log.error(
      "Could not detect GitHub repo. Run inside a clone with `gh` configured.",
    );
    followUpItems.push("Set up GitHub CLI in this clone, then re-run");
    return { success: false, followUpItems };
  }

  const appDir = `${projectRoot}/app`;
  const lookup = fetchTeamLookup(appDir);

  if (doctorMode) {
    return reportStatus(repo.nameWithOwner, lookup.linked?.slug);
  }

  const proceed = await promptConfirm(
    `Configure Vercel Remote Cache for ${pc.cyan(repo.nameWithOwner)}?`,
    false,
  );
  if (!proceed) {
    logSubline(
      pc.dim("Skipped — re-run anytime with `pnpm bootstrap --ci-cache`."),
    );
    return { success: true, followUpItems: [] };
  }

  const teamSlug = await resolveTeamSlug(lookup);
  if (!teamSlug) {
    followUpItems.push(
      "Could not determine Vercel team. Re-run after `vercel link` in app/.",
    );
    return { success: false, followUpItems };
  }

  const tokenOk = await ensureSecret(repo.nameWithOwner, followUpItems);
  if (!tokenOk) {
    return { success: false, followUpItems };
  }

  const teamOk = await ensureVariable(
    repo.nameWithOwner,
    teamSlug,
    followUpItems,
  );
  if (!teamOk) {
    return { success: false, followUpItems };
  }

  log.success(`Vercel Remote Cache wired for ${pc.cyan(repo.nameWithOwner)}.`);
  logSubline(`Secret: ${pc.dim(SECRET_NAME)}  Variable: ${pc.dim(VAR_NAME)}`);
  logSubline(
    pc.dim(
      "CI runs of `turbo run …` will now read/write the shared remote cache.",
    ),
  );

  return { success: true, followUpItems };
}

// ── Detection ────────────────────────────────────────────────────────────────

function detectRepo(): RepoIdentity | undefined {
  const result = runCommand("gh repo view --json nameWithOwner 2>/dev/null");
  if (!result.ok) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as { nameWithOwner?: string };
    if (!parsed.nameWithOwner) return undefined;
    return { nameWithOwner: parsed.nameWithOwner };
  } catch {
    return undefined;
  }
}

function fetchTeamLookup(appDir: string): TeamLookup {
  const teams = listVercelTeams();
  const linkedId = isVercelLinked(appDir) ? getVercelScope(appDir) : undefined;
  const linked = linkedId
    ? teams.find((t) => t.id === linkedId)
    : teams.find((t) => t.current);
  return { teams, linked };
}

function listVercelTeams(): VercelTeam[] {
  const result = runCommand("vercel teams ls --format json 2>/dev/null");
  if (!result.ok) return [];
  try {
    const parsed = JSON.parse(result.stdout) as { teams?: VercelTeam[] };
    return Array.isArray(parsed.teams) ? parsed.teams : [];
  } catch {
    return [];
  }
}

function reportStatus(
  nameWithOwner: string,
  teamSlug: string | undefined,
): PhaseResult {
  const secretSet = repoHasSecret(nameWithOwner, SECRET_NAME);
  const variableSet = repoHasVariable(nameWithOwner, VAR_NAME);

  logSubline(
    `${SECRET_NAME}: ${secretSet ? pc.green("set") : pc.yellow("missing")}`,
  );
  logSubline(
    `${VAR_NAME}: ${variableSet ? pc.green("set") : pc.yellow("missing")}${
      teamSlug ? pc.dim(` (detected: ${teamSlug})`) : ""
    }`,
  );

  return {
    success: secretSet && variableSet,
    followUpItems:
      secretSet && variableSet
        ? []
        : ["Run `pnpm bootstrap --ci-cache` to configure Vercel Remote Cache"],
  };
}

// ── Secret ───────────────────────────────────────────────────────────────────

async function ensureSecret(
  nameWithOwner: string,
  followUpItems: string[],
): Promise<boolean> {
  if (repoHasSecret(nameWithOwner, SECRET_NAME)) {
    const replace = await promptConfirm(
      `${SECRET_NAME} is already set on ${nameWithOwner}. Mint a new Vercel token and replace it?`,
      false,
    );
    if (!replace) {
      logSubline(`Kept existing ${SECRET_NAME}`);
      return true;
    }
  }

  const mintSpinner = spinner();
  mintSpinner.start(`Minting Vercel access token "${TOKEN_NAME}"...`);

  const token = mintVercelToken();
  if (!token) {
    mintSpinner.stop("Failed to mint Vercel token");
    followUpItems.push(
      `Run: vercel tokens add ${TOKEN_NAME} --format json (then re-run bootstrap --ci-cache)`,
    );
    return false;
  }

  mintSpinner.stop(`Minted Vercel token "${TOKEN_NAME}"`);

  const setSpinner = spinner();
  setSpinner.start(`Setting ${SECRET_NAME} on ${nameWithOwner}...`);

  const result = spawnSync(
    "gh",
    ["secret", "set", SECRET_NAME, "--repo", nameWithOwner, "--body", "-"],
    { input: token, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" },
  );

  if (result.status !== 0) {
    setSpinner.stop(`Failed to set ${SECRET_NAME}`);
    log.error(result.stderr.trim() || "gh secret set failed");
    followUpItems.push(
      `Run: gh secret set ${SECRET_NAME} --repo ${nameWithOwner}`,
    );
    return false;
  }

  setSpinner.stop(`${SECRET_NAME} set on ${nameWithOwner}`);
  logSubline(
    pc.dim(
      `Revoke later via: vercel tokens remove <id> (list with: vercel tokens list)`,
    ),
  );
  return true;
}

function mintVercelToken(): string | undefined {
  // `vercel tokens add NAME --format json` writes a clean JSON payload of the
  // POST /v3/user/tokens response. The bearer token only appears in this
  // response — list/show endpoints redact it.
  const result = runCommand(`vercel tokens add "${TOKEN_NAME}" --format json`);
  if (!result.ok) {
    const stderr = result.stderr || "";
    if (/classic|user account scope|OAuth/i.test(stderr)) {
      log.error(
        "Vercel CLI is OAuth-authenticated, which cannot create new tokens.",
      );
      logSubline(
        pc.dim(
          "Re-auth with a classic PAT (`vercel logout && vercel login`, choose email) and retry.",
        ),
      );
    } else {
      log.error(stderr || "vercel tokens add failed");
    }
    return undefined;
  }

  const parsed = JSON.parse(result.stdout) as { bearerToken?: unknown };
  if (
    typeof parsed.bearerToken !== "string" ||
    parsed.bearerToken.length === 0
  ) {
    log.error("Vercel CLI did not return a bearerToken in JSON output.");
    return undefined;
  }
  return parsed.bearerToken;
}

function repoHasSecret(nameWithOwner: string, name: string): boolean {
  const result = runCommand(
    `gh secret list --repo "${nameWithOwner}" 2>/dev/null`,
  );
  if (!result.ok) return false;
  return result.stdout
    .split("\n")
    .some((line) => line.split(/\s+/)[0] === name);
}

// ── Variable ─────────────────────────────────────────────────────────────────

async function resolveTeamSlug(
  lookup: TeamLookup,
): Promise<string | undefined> {
  if (lookup.linked) {
    logSubline(
      `Using linked Vercel team: ${pc.cyan(lookup.linked.slug)} ${pc.dim(`(${lookup.linked.name})`)}`,
    );
    return lookup.linked.slug;
  }

  if (lookup.teams.length === 0) {
    log.error(
      "Vercel CLI returned no teams. Are you logged in (`vercel whoami`)?",
    );
    return undefined;
  }

  const [only, ...rest] = lookup.teams;
  if (only && rest.length === 0) {
    logSubline(
      `Using only available Vercel team: ${pc.cyan(only.slug)} ${pc.dim(`(${only.name})`)}`,
    );
    return only.slug;
  }

  const { select } = await import("@clack/prompts");
  const initial = lookup.teams.find((t) => t.current)?.slug;
  const slug = (await promptOrExit(
    select({
      message: "Pick the Vercel team to use for TURBO_TEAM",
      options: lookup.teams.map((t) => ({
        value: t.slug,
        label: t.slug,
        hint: t.name,
      })),
      initialValue: initial,
    }),
  )) as string;
  return slug;
}

async function ensureVariable(
  nameWithOwner: string,
  slug: string,
  followUpItems: string[],
): Promise<boolean> {
  if (repoHasVariable(nameWithOwner, VAR_NAME)) {
    const replace = await promptConfirm(
      `${VAR_NAME} is already set on ${nameWithOwner}. Overwrite with "${slug}"?`,
      false,
    );
    if (!replace) {
      logSubline(`Kept existing ${VAR_NAME}`);
      return true;
    }
  }

  const s = spinner();
  s.start(`Setting ${VAR_NAME}=${slug} on ${nameWithOwner}...`);

  const result = runCommand(
    `gh variable set ${VAR_NAME} --repo "${nameWithOwner}" --body "${slug}"`,
  );

  if (!result.ok) {
    s.stop(`Failed to set ${VAR_NAME}`);
    log.error(commandOutput(result));
    followUpItems.push(
      `Run: gh variable set ${VAR_NAME} --repo ${nameWithOwner} --body ${slug}`,
    );
    return false;
  }

  s.stop(`${VAR_NAME}=${slug} set on ${nameWithOwner}`);
  return true;
}

function repoHasVariable(nameWithOwner: string, name: string): boolean {
  const result = runCommand(
    `gh variable list --repo "${nameWithOwner}" 2>/dev/null`,
  );
  if (!result.ok) return false;
  return result.stdout
    .split("\n")
    .some((line) => line.split(/\s+/)[0] === name);
}
