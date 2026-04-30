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
 *   pnpm bootstrap --mcp-registry      Run MCP Registry publisher setup only
 *   pnpm bootstrap --ci-cache          Wire Vercel Remote Cache into Actions
 *   pnpm bootstrap --api-domain        Ensure atlas-api Cloud Run + Cloudflare CNAME
 *   pnpm bootstrap --api-domain --target staging  Same, for atlas-api-staging
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
import { runMcpRegistryPhase } from "./phases/mcp-registry.js";
import { runCiCachePhase } from "./phases/ci-cache.js";
import {
  runApiDomainPhase,
  type ApiDomainTarget,
} from "./phases/api-domain.js";

interface CliArgs {
  localOnly: boolean;
  doctorMode: boolean;
  resume: boolean;
  productOnly: string | null;
  mcpRegistryOnly: boolean;
  ciCacheOnly: boolean;
  apiDomainOnly: boolean;
  apiDomainTarget: ApiDomainTarget;
  live: boolean;
}

function parseArgs(argv: string[]): CliArgs {
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
    apiDomainTarget,
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

  // MCP Registry-only mode
  if (args.mcpRegistryOnly) {
    log.info("Running MCP Registry publisher setup only.");
    const result = await runMcpRegistryPhase(projectRoot, args.doctorMode);
    markPhase(state, "mcp-registry", result.success ? "complete" : "partial");
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(result.followUpItems.join("\n"), "Follow-up");
    }
    outro(
      result.success
        ? "MCP Registry publisher setup complete."
        : "MCP Registry publisher setup had issues.",
    );
    return;
  }

  // CI cache-only mode
  if (args.ciCacheOnly) {
    log.info("Running Vercel Remote Cache wiring only.");
    const result = await runCiCachePhase(projectRoot, args.doctorMode);
    markPhase(state, "ci-cache", result.success ? "complete" : "partial");
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(result.followUpItems.join("\n"), "Follow-up");
    }
    outro(
      result.success
        ? "Vercel Remote Cache wired into GitHub Actions."
        : "CI cache wiring had issues.",
    );
    return;
  }

  // API domain-only mode
  if (args.apiDomainOnly) {
    log.info(
      `Running atlas-api domain mapping only (target=${args.apiDomainTarget}).`,
    );
    const result = await runApiDomainPhase(
      projectRoot,
      args.doctorMode,
      args.apiDomainTarget,
    );
    markPhase(state, "api-domain", result.success ? "complete" : "partial");
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(result.followUpItems.join("\n"), "Follow-up");
    }
    outro(
      result.success
        ? `atlas-api ${args.apiDomainTarget} canonical domain ready.`
        : "API domain wiring had issues.",
    );
    return;
  }

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
    let installOk = runCommand("pnpm install --frozen-lockfile").ok;
    if (!installOk) {
      installOk = runCommand("pnpm install").ok;
    }
    if (installOk) {
      log.success("Workspace dependencies installed.");
    } else {
      log.error("pnpm install failed. Fix dependency issues and re-run.");
      allFollowUp.push("Resolve pnpm install errors and re-run bootstrap.");
    }
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

    // Phase 7: MCP Registry publisher (opt-in inside the phase)
    if (
      !shouldSkipPhase("mcp-registry", state, args.resume) ||
      !(await confirmResumeSkip("MCP Registry"))
    ) {
      log.step("Phase 7: MCP Registry Publisher");
      const result = await runMcpRegistryPhase(projectRoot, args.doctorMode);
      markPhase(state, "mcp-registry", result.success ? "complete" : "partial");
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 8: Deploy
    if (
      !shouldSkipPhase("deploy", state, args.resume) ||
      !(await confirmResumeSkip("Deploy"))
    ) {
      log.step("Phase 8: Initial Deployment");
      const result = await runDeployPhase(projectRoot, state, args.doctorMode);
      markPhase(state, "deploy", result.success ? "complete" : "skipped");
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 9: CI Remote Cache (Vercel Remote Cache for GitHub Actions)
    if (
      !shouldSkipPhase("ci-cache", state, args.resume) ||
      !(await confirmResumeSkip("CI Cache"))
    ) {
      log.step("Phase 9: CI Remote Cache");
      const result = await runCiCachePhase(projectRoot, args.doctorMode);
      markPhase(state, "ci-cache", result.success ? "complete" : "partial");
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 10: API canonical domain (Cloud Run mapping + Cloudflare CNAME)
    if (
      !shouldSkipPhase("api-domain", state, args.resume) ||
      !(await confirmResumeSkip("API Domain"))
    ) {
      log.step("Phase 10: API Canonical Domain");
      const result = await runApiDomainPhase(projectRoot, args.doctorMode);
      markPhase(state, "api-domain", result.success ? "complete" : "partial");
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
