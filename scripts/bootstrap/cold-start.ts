#!/usr/bin/env tsx
/**
 * Atlas Bootstrap CLI — Complete product development, deployment, and operations setup.
 *
 * Usage:
 *   pnpm bootstrap                     Full interactive setup
 *   pnpm bootstrap --local-only        Local dev only (skip deploy/product phases)
 *   pnpm bootstrap --doctor            Check readiness without changes
 *   pnpm bootstrap --resume            Skip completed phases
 *   pnpm bootstrap --product atlas     Run Stripe product sync only
 *   pnpm bootstrap --live              Use Stripe live mode (default: test)
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { intro, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { detectOs } from "./lib/os.js";
import type { PhaseId } from "./lib/types.js";
import { runCommand } from "./lib/shell.js";
import { promptConfirm } from "./lib/ui.js";
import { loadReadiness, markPhase, saveReadiness } from "./state.js";
import { COMMAND_CAPABILITY_MAP } from "./config/prerequisites.js";
import { runInstallPhase } from "./phases/install.js";
import { runAuthPhase } from "./phases/auth.js";
import { runEnvPhase } from "./phases/env.js";
import { runInfraPhase } from "./phases/infra.js";
import { runDatabasePhase } from "./phases/database.js";
import { runProductPhase } from "./products/atlas/bootstrap.js";
import { runDeployPhase } from "./phases/deploy.js";

interface CliArgs {
  localOnly: boolean;
  doctorMode: boolean;
  resume: boolean;
  productOnly: string | null;
  live: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  return {
    localOnly: argv.includes("--local-only"),
    doctorMode: argv.includes("--doctor"),
    resume: argv.includes("--resume"),
    productOnly: argv.includes("--product")
      ? (argv[argv.indexOf("--product") + 1] ?? null)
      : null,
    live: argv.includes("--live"),
  };
}

function shouldSkipPhase(
  phaseId: PhaseId,
  state: ReturnType<typeof loadReadiness>,
  resume: boolean,
): boolean {
  if (!resume) return false;
  return state.phases[phaseId]?.status === "complete";
}

async function confirmResumeSkip(phaseName: string): Promise<boolean> {
  return !(await promptConfirm(
    `${phaseName} was already completed. Re-run it?`,
    false,
  ));
}

function recomputeCommandReadiness(
  state: ReturnType<typeof loadReadiness>,
): void {
  for (const [group, requiredCaps] of Object.entries(COMMAND_CAPABILITY_MAP)) {
    const allReady = requiredCaps.every(
      (capId) => state.capabilities[capId]?.status === "ready",
    );
    state.commandReadiness[group as keyof typeof state.commandReadiness] =
      allReady ? "ready" : "blocked";
  }
}

function printSummary(state: ReturnType<typeof loadReadiness>): void {
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

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, "../..");
  const args = parseArgs(process.argv.slice(2));

  intro(
    args.doctorMode
      ? pc.bgCyan(pc.black(" Atlas Doctor "))
      : pc.bgBlue(pc.white(" Atlas Bootstrap ")),
  );

  const os = detectOs();
  if (!os) {
    log.error("Unsupported operating system. Atlas requires macOS or Linux.");
    process.exit(1);
  }

  const state = loadReadiness(projectRoot);
  const allFollowUp: string[] = [];

  // Product-only mode
  if (args.productOnly === "atlas") {
    log.info("Running Stripe product sync only.");
    const result = await runProductPhase(
      projectRoot,
      state,
      args.doctorMode,
      args.live,
    );
    markPhase(state, "product", result.success ? "complete" : "failed");
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(result.followUpItems.join("\n"), "Follow-up");
    }
    outro(
      result.success ? "Product sync complete." : "Product sync had issues.",
    );
    return;
  }

  // Phase 1: Install
  if (
    !shouldSkipPhase("install", state, args.resume) ||
    !(await confirmResumeSkip("Install"))
  ) {
    log.step("Phase 1: System Dependencies");
    const result = await runInstallPhase(
      state,
      os,
      args.doctorMode,
      args.localOnly,
    );
    markPhase(state, "install", result.success ? "complete" : "partial");
    saveReadiness(projectRoot, state);
    allFollowUp.push(...result.followUpItems);
  }

  // Workspace install (pnpm install)
  if (!args.doctorMode) {
    log.step("Installing workspace dependencies...");
    const pnpmResult = runCommand("pnpm install --frozen-lockfile");
    if (!pnpmResult.ok) {
      // Try without frozen lockfile
      const retryResult = runCommand("pnpm install");
      if (!retryResult.ok) {
        log.error("pnpm install failed. Fix dependency issues and re-run.");
      }
    }
    log.success("Workspace dependencies installed.");
  }

  // Phase 2: Auth
  if (
    !shouldSkipPhase("auth", state, args.resume) ||
    !(await confirmResumeSkip("Auth"))
  ) {
    log.step("Phase 2: CLI Authentication");
    const result = await runAuthPhase(state, args.doctorMode, args.localOnly);
    markPhase(state, "auth", result.success ? "complete" : "partial");
    saveReadiness(projectRoot, state);
    allFollowUp.push(...result.followUpItems);
  }

  // Phase 3: Environment
  if (
    !shouldSkipPhase("env", state, args.resume) ||
    !(await confirmResumeSkip("Environment"))
  ) {
    log.step("Phase 3: Environment Configuration");
    const result = await runEnvPhase(
      projectRoot,
      args.doctorMode,
      state,
      !args.localOnly,
    );
    markPhase(state, "env", result.success ? "complete" : "partial");
    saveReadiness(projectRoot, state);
    allFollowUp.push(...result.followUpItems);
  }

  if (!args.localOnly) {
    // Phase 4: Infrastructure
    if (
      !shouldSkipPhase("infra", state, args.resume) ||
      !(await confirmResumeSkip("Infrastructure"))
    ) {
      log.step("Phase 4: Cloud Infrastructure");
      const result = await runInfraPhase(projectRoot, state, args.doctorMode);
      markPhase(state, "infra", result.success ? "complete" : "failed");
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 5: Database
    if (
      !shouldSkipPhase("database", state, args.resume) ||
      !(await confirmResumeSkip("Database"))
    ) {
      log.step("Phase 5: Database");
      const result = await runDatabasePhase(
        projectRoot,
        state,
        args.doctorMode,
      );
      markPhase(state, "database", result.success ? "complete" : "failed");
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 6: Product (Stripe)
    if (
      !shouldSkipPhase("product", state, args.resume) ||
      !(await confirmResumeSkip("Product"))
    ) {
      log.step("Phase 6: Stripe Products");
      const result = await runProductPhase(
        projectRoot,
        state,
        args.doctorMode,
        args.live,
      );
      markPhase(state, "product", result.success ? "complete" : "failed");
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 7: Deploy
    if (
      !shouldSkipPhase("deploy", state, args.resume) ||
      !(await confirmResumeSkip("Deploy"))
    ) {
      log.step("Phase 7: Initial Deployment");
      const result = await runDeployPhase(projectRoot, state, args.doctorMode);
      markPhase(state, "deploy", result.success ? "complete" : "skipped");
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }
  }

  // Final state
  recomputeCommandReadiness(state);
  saveReadiness(projectRoot, state);
  printSummary(state);

  if (allFollowUp.length > 0) {
    note(allFollowUp.join("\n"), "Follow-up Items");
  }

  outro(
    args.doctorMode
      ? "Doctor check complete."
      : pc.green("Atlas bootstrap complete."),
  );
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
