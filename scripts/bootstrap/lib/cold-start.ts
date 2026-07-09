import { note } from "@clack/prompts";
import pc from "picocolors";
import { COMMAND_CAPABILITY_MAP } from "../config/prerequisites.js";
import type { StripeBootstrapTarget } from "../products/atlas/env.js";
import type { ApiDomainTarget } from "../phases/api-domain.js";
import { promptConfirm } from "./ui.js";
import type { PhaseId, ReadinessState } from "../state.js";

export interface CliArgs {
  localOnly: boolean;
  doctorMode: boolean;
  resume: boolean;
  productOnly: string | null;
  mcpRegistryOnly: boolean;
  ciCacheOnly: boolean;
  apiDomainOnly: boolean;
  apiEdgeOnly: boolean;
  apiDomainTarget: ApiDomainTarget;
  assumeYes: boolean;
  stripeTarget: StripeBootstrapTarget;
  live: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const targetIdx = argv.indexOf("--target");
  const explicitTarget =
    targetIdx >= 0 ? (argv[targetIdx + 1] ?? "prod") : null;
  const explicitLocalOnly = argv.includes("--local-only");
  const productOnly = argv.includes("--product")
    ? (argv[argv.indexOf("--product") + 1] ?? null)
    : null;
  const hasHostedOnlyMode =
    argv.includes("--api-domain") ||
    argv.includes("--api-edge") ||
    argv.includes("--ci-cache");
  const defaultTarget = explicitLocalOnly || productOnly ? "local" : "prod";
  const targetArg =
    explicitTarget ?? (argv.includes("--live") ? "prod" : defaultTarget);
  const apiDomainTarget: ApiDomainTarget =
    targetArg === "staging" ? "staging" : "prod";
  const stripeTarget: StripeBootstrapTarget =
    targetArg === "staging"
      ? "staging"
      : targetArg === "prod"
        ? "prod"
        : "local";
  const live =
    argv.includes("--live") ||
    (!explicitTarget && !explicitLocalOnly && !productOnly);
  return {
    localOnly: explicitLocalOnly && !hasHostedOnlyMode,
    doctorMode: argv.includes("--doctor"),
    resume: argv.includes("--resume"),
    productOnly,
    mcpRegistryOnly: argv.includes("--mcp-registry"),
    ciCacheOnly: argv.includes("--ci-cache"),
    apiDomainOnly: argv.includes("--api-domain"),
    apiEdgeOnly: argv.includes("--api-edge"),
    apiDomainTarget,
    assumeYes: argv.includes("--yes"),
    stripeTarget,
    live,
  };
}

export function shouldSkipPhase(
  phaseId: PhaseId,
  state: ReadinessState,
  resume: boolean,
): boolean {
  if (!resume) return false;
  return state.phases[phaseId]?.status === "complete";
}

export function shouldStopAfterAuthFailure(
  doctorMode: boolean,
  authSuccess: boolean,
): boolean {
  return !doctorMode && !authSuccess;
}

export async function confirmResumeSkip(phaseName: string): Promise<boolean> {
  return !(await promptConfirm(
    [
      `${phaseName} was already completed.`,
      "",
      "Choose Yes to re-run this phase and refresh its setup state.",
      "Choose No to keep the recorded completion and continue to the next phase.",
    ].join("\n"),
    false,
  ));
}

export function recomputeCommandReadiness(state: ReadinessState): void {
  for (const [group, requiredCaps] of Object.entries(COMMAND_CAPABILITY_MAP)) {
    const allReady = requiredCaps.every(
      (capId) => state.capabilities[capId]?.status === "ready",
    );
    state.commandReadiness[group as keyof typeof state.commandReadiness] =
      allReady ? "ready" : "blocked";
  }
}

export function describePhase(phaseName: string): string {
  const descriptions: Record<string, string> = {
    "Setup Prerequisites":
      "Checking every command-line tool bootstrap may use, showing detected versions, and offering installs for missing tools.",
    "Workspace Packages":
      "Installing pnpm workspace packages so repo scripts, generated clients, and setup helpers can run.",
    "CLI Authentication":
      "Reviewing each signed-in CLI account one at a time and letting you switch before bootstrap uses it.",
    "Environment Configuration":
      "Creating env files, preserving existing values, and asking for the human-owned values the repo cannot infer.",
    "Stripe Products":
      "Confirming the Stripe account, then creating or updating products, prices, coupons, webhooks, and env values.",
    "Cloud Infrastructure":
      "Creating or updating the hosted cloud resources Atlas needs before it can deploy.",
    Database:
      "Checking database access, creating the database when needed, and applying schema setup.",
    "MCP Registry Publisher":
      "Checking the MCP Registry publisher identity and DNS proof needed to publish.",
    "Initial Deployment":
      "Building, pushing, and deploying the Atlas services.",
    "CI Remote Cache":
      "Checking Vercel Remote Cache credentials and wiring them into GitHub Actions.",
    "API Canonical Domain":
      "Checking the canonical atlas-api domain, Cloud Run mapping, and DNS record.",
    "API Edge Protection":
      "Checking Cloudflare proxying and API edge protection for the public API.",
  };
  return descriptions[phaseName] ?? `Running ${phaseName}.`;
}

export function phaseEntriesForSummary(
  state: ReadinessState,
  attemptedPhases?: Set<PhaseId>,
): [string, NonNullable<ReadinessState["phases"][PhaseId]>][] {
  return Object.entries(state.phases).filter(
    (
      entry,
    ): entry is [string, NonNullable<ReadinessState["phases"][PhaseId]>] =>
      entry[1] !== undefined &&
      (!attemptedPhases || attemptedPhases.has(entry[0] as PhaseId)),
  );
}

export function printSummary(
  state: ReadinessState,
  attemptedPhases?: Set<PhaseId>,
): void {
  const lines: string[] = [];

  lines.push(pc.bold("Command Readiness:"));
  for (const [group, status] of Object.entries(state.commandReadiness)) {
    const icon = status === "ready" ? pc.green("ready") : pc.yellow("blocked");
    lines.push(`  ${group}: ${icon}`);
  }

  lines.push("");
  lines.push(pc.bold(attemptedPhases ? "This Run:" : "Phases:"));
  for (const [phase, phaseState] of phaseEntriesForSummary(
    state,
    attemptedPhases,
  )) {
    const icon =
      phaseState.status === "complete"
        ? pc.green("complete")
        : phaseState.status === "failed"
          ? pc.red("failed")
          : pc.yellow(phaseState.status);
    lines.push(`  ${phase}: ${icon}`);
  }
  if (attemptedPhases?.size === 0) {
    lines.push("  No phases ran.");
  }

  note(lines.join("\n"), "Bootstrap Status");
}
