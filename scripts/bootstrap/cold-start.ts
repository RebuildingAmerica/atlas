#!/usr/bin/env tsx
/**
 * Atlas Bootstrap CLI — Complete product development, deployment, and operations setup.
 *
 * Usage:
 *
 * | Command                                                   | What it does |
 * | --------------------------------------------------------- | ------------ |
 * | `pnpm setup`                                              | Full guided repo setup, including production readiness. |
 * | `pnpm setup:local`                                        | Local dev setup, including local Stripe test-mode sync. |
 * | `pnpm setup:staging`                                      | Staging setup: its own GCP project, Cloud Run service, Stripe test-mode sync, and Vercel Preview env sync. |
 * | `pnpm setup:prod`                                         | Production setup, including Stripe live-mode sync and Vercel Production env sync. |
 * | `pnpm doctor`                                             | Checks readiness without changing local or hosted state. |
 * | `pnpm bootstrap`                                          | Full guided repo setup, including production readiness. |
 * | `pnpm bootstrap --local-only`                             | Local dev setup, including local Stripe test-mode sync. |
 * | `pnpm bootstrap --doctor`                                 | Checks readiness without changing local or hosted state. |
 * | `pnpm bootstrap --resume`                                 | Skips phases already marked complete. |
 * | `pnpm bootstrap --product atlas`                          | Runs local Stripe test-mode sync only. |
 * | `pnpm bootstrap --product atlas --target staging`         | Runs staging Stripe test-mode sync. |
 * | `pnpm bootstrap --product atlas --target staging --yes`   | Applies hosted staging env sync without prompting. |
 * | `pnpm bootstrap --product atlas --target prod --live`     | Runs production Stripe live sync. |
 * | `pnpm bootstrap --mcp-registry`                           | Runs MCP Registry publisher setup only. |
 * | `pnpm bootstrap --infra`                                  | Runs production cloud infrastructure setup only. |
 * | `pnpm bootstrap --infra --target staging`                 | Runs staging cloud infrastructure setup only. |
 * | `pnpm bootstrap --ci-cache`                               | Reports the turnkey GitHub Actions cache. |
 * | `pnpm bootstrap --api-domain`                             | Ensures atlas-api Cloud Run and Cloudflare CNAME. |
 * | `pnpm bootstrap --api-domain --target staging`            | Ensures the staging atlas-api Cloud Run and Cloudflare CNAME. |
 * | `pnpm bootstrap --api-edge`                               | Enables Cloudflare proxy and API rate limits. |
 * | `pnpm bootstrap --api-edge --target staging`              | Enables staging Cloudflare proxy and API rate limits. |
 * | `pnpm bootstrap --target prod --live`                     | Runs explicit production setup. |
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { intro, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { detectOs } from "./lib/os.js";
import {
  bootstrapOutroMessage,
  confirmResumeSkip,
  describePhase,
  formatFollowUpNote,
  parseArgs,
  printSummary,
  recomputeCommandReadiness,
  shouldStopAfterAuthFailure,
  shouldSkipPhase,
} from "./lib/cold-start.js";
import { runCommand } from "./lib/shell.js";
import { loadReadiness, markPhase, saveReadiness } from "./state.js";
import type { PhaseId } from "./state.js";
import { runInstallPhase } from "./phases/install.js";
import { runAuthPhase } from "./phases/auth.js";
import { runEnvPhase } from "./phases/env.js";
import { runProductPhase } from "./products/atlas/bootstrap.js";
import { renderSetupGuide } from "./config/setup-manifest.js";
import { runHostedPhases } from "./hosted-phases.js";
import {
  reportedPhaseStatus,
  resultPhaseStatus,
  type BootstrapRun,
} from "./run-context.js";
import { runSingleMode, selectSingleMode } from "./single-mode.js";

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
  const attemptedPhases = new Set<PhaseId>();
  const run: BootstrapRun = {
    projectRoot,
    args,
    state,
    allFollowUp,
    attemptedPhases,
  };

  if (
    !args.productOnly &&
    !args.infraOnly &&
    !args.mcpRegistryOnly &&
    !args.ciCacheOnly &&
    !args.apiDomainOnly &&
    !args.apiEdgeOnly
  ) {
    note(
      renderSetupGuide(args.localOnly ? "local" : args.stripeTarget),
      "Repo setup checklist",
    );
  }

  const singleMode = selectSingleMode(run);
  if (singleMode) {
    await runSingleMode(run, singleMode);
    return;
  }

  // Phase 1: Install
  if (
    !shouldSkipPhase("install", state, args.resume) ||
    !(await confirmResumeSkip("Install"))
  ) {
    log.step("Phase 1: Setup Prerequisites");
    log.info(describePhase("Setup Prerequisites"));
    attemptedPhases.add("install");
    const result = await runInstallPhase(
      state,
      os,
      args.doctorMode,
      args.localOnly,
    );
    markPhase(state, "install", reportedPhaseStatus(result));
    saveReadiness(projectRoot, state);
    allFollowUp.push(...result.followUpItems);
  }

  // Workspace packages (pnpm install)
  if (!args.doctorMode) {
    log.step("Installing workspace packages...");
    log.info(describePhase("Workspace Packages"));
    let installOk = runCommand("pnpm install --frozen-lockfile").ok;
    if (!installOk) {
      installOk = runCommand("pnpm install").ok;
    }
    if (installOk) {
      log.success("Workspace packages installed.");
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
    log.info(describePhase("CLI Authentication"));
    attemptedPhases.add("auth");
    const result = await runAuthPhase(
      state,
      args.doctorMode,
      args.localOnly,
      args.assumeYes,
    );
    markPhase(state, "auth", reportedPhaseStatus(result));
    saveReadiness(projectRoot, state);
    allFollowUp.push(...result.followUpItems);
    if (shouldStopAfterAuthFailure(args.doctorMode, result.success)) {
      recomputeCommandReadiness(state);
      saveReadiness(projectRoot, state);
      printSummary(state, attemptedPhases);
      if (allFollowUp.length > 0) {
        note(formatFollowUpNote(allFollowUp), "Follow-up Items");
      }
      outro("Bootstrap stopped before environment setup.");
      return;
    }
  }

  // Phase 3: Environment
  if (
    !shouldSkipPhase("env", state, args.resume) ||
    !(await confirmResumeSkip("Environment"))
  ) {
    log.step("Phase 3: Environment Configuration");
    log.info(describePhase("Environment Configuration"));
    attemptedPhases.add("env");
    const hostedTarget = args.localOnly
      ? null
      : args.stripeTarget === "staging"
        ? "staging"
        : "production";
    const result = await runEnvPhase(
      projectRoot,
      args.doctorMode,
      state,
      hostedTarget,
      args.assumeYes,
    );
    markPhase(state, "env", reportedPhaseStatus(result));
    saveReadiness(projectRoot, state);
    allFollowUp.push(...result.followUpItems);
  }

  if (args.localOnly) {
    log.step("Phase 4: Stripe Products");
    log.info(describePhase("Stripe Products"));
    attemptedPhases.add("product");
    const result = await runProductPhase(
      projectRoot,
      state,
      args.doctorMode,
      false,
      "local",
      args.assumeYes,
    );
    markPhase(state, "product", resultPhaseStatus(result, args.doctorMode));
    saveReadiness(projectRoot, state);
    allFollowUp.push(...result.followUpItems);
  }

  if (!args.localOnly) {
    await runHostedPhases(run);
  }

  // Final state
  recomputeCommandReadiness(state);
  saveReadiness(projectRoot, state);
  printSummary(state, attemptedPhases);

  if (allFollowUp.length > 0) {
    note(formatFollowUpNote(allFollowUp), "Follow-up Items");
  }

  const outroMessage = bootstrapOutroMessage({
    doctorMode: args.doctorMode,
    hasFollowUps: allFollowUp.length > 0,
  });
  outro(
    allFollowUp.length > 0 ? pc.yellow(outroMessage) : pc.green(outroMessage),
  );
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
