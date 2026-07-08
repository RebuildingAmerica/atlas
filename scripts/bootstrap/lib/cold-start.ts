import { note } from "@clack/prompts";
import pc from "picocolors";
import { COMMAND_CAPABILITY_MAP } from "../config/prerequisites.js";
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
  live: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const targetIdx = argv.indexOf("--target");
  const targetArg = targetIdx >= 0 ? (argv[targetIdx + 1] ?? "prod") : "prod";
  const apiDomainTarget: ApiDomainTarget =
    targetArg === "staging" ? "staging" : "prod";
  return {
    localOnly: argv.includes("--local-only"),
    doctorMode: argv.includes("--doctor"),
    resume: argv.includes("--resume"),
    productOnly: argv.includes("--product")
      ? (argv[argv.indexOf("--product") + 1] ?? null)
      : null,
    mcpRegistryOnly: argv.includes("--mcp-registry"),
    ciCacheOnly: argv.includes("--ci-cache"),
    apiDomainOnly: argv.includes("--api-domain"),
    apiEdgeOnly: argv.includes("--api-edge"),
    apiDomainTarget,
    live: argv.includes("--live"),
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

export async function confirmResumeSkip(phaseName: string): Promise<boolean> {
  return !(await promptConfirm(
    `${phaseName} was already completed. Re-run it?`,
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

export function printSummary(state: ReadinessState): void {
  const lines: string[] = [];

  lines.push(pc.bold("Command Readiness:"));
  for (const [group, status] of Object.entries(state.commandReadiness)) {
    const icon = status === "ready" ? pc.green("ready") : pc.yellow("blocked");
    lines.push(`  ${group}: ${icon}`);
  }

  lines.push("");
  lines.push(pc.bold("Phases:"));
  for (const [phase, phaseState] of Object.entries(state.phases)) {
    const icon =
      phaseState.status === "complete"
        ? pc.green("complete")
        : phaseState.status === "failed"
          ? pc.red("failed")
          : pc.yellow(phaseState.status);
    lines.push(`  ${phase}: ${icon}`);
  }

  note(lines.join("\n"), "Bootstrap Status");
}
