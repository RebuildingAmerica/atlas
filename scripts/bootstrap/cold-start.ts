#!/usr/bin/env tsx
/**
 * Atlas Bootstrap CLI — Complete product development, deployment, and operations setup.
 *
 * Usage:
 *
 * | Command                                                   | What it does |
 * | --------------------------------------------------------- | ------------ |
 * | `pnpm setup`                                              | Local dev setup, including local Stripe test-mode sync. |
 * | `pnpm setup:staging`                                      | Staging setup, including Stripe test-mode sync and Vercel Preview env sync. |
 * | `pnpm setup:prod`                                         | Production setup, including Stripe live-mode sync and Vercel Production env sync. |
 * | `pnpm doctor`                                             | Checks readiness without changing local or hosted state. |
 * | `pnpm bootstrap`                                          | Full interactive setup. |
 * | `pnpm bootstrap --local-only`                             | Local dev setup, including local Stripe test-mode sync. |
 * | `pnpm bootstrap --doctor`                                 | Checks readiness without changing local or hosted state. |
 * | `pnpm bootstrap --resume`                                 | Skips phases already marked complete. |
 * | `pnpm bootstrap --product atlas`                          | Runs local Stripe test-mode sync only. |
 * | `pnpm bootstrap --product atlas --target staging`         | Runs staging Stripe test-mode sync. |
 * | `pnpm bootstrap --product atlas --target staging --yes`   | Applies hosted staging env sync without prompting. |
 * | `pnpm bootstrap --product atlas --target prod --live`     | Runs production Stripe live sync. |
 * | `pnpm bootstrap --mcp-registry`                           | Runs MCP Registry publisher setup only. |
 * | `pnpm bootstrap --ci-cache`                               | Wires Vercel Remote Cache into Actions. |
 * | `pnpm bootstrap --api-domain`                             | Ensures atlas-api Cloud Run and Cloudflare CNAME. |
 * | `pnpm bootstrap --api-domain --target staging`            | Ensures the staging atlas-api Cloud Run and Cloudflare CNAME. |
 * | `pnpm bootstrap --api-edge`                               | Enables Cloudflare proxy and API rate limits. |
 * | `pnpm bootstrap --api-edge --target staging`              | Enables staging Cloudflare proxy and API rate limits. |
 * | `pnpm bootstrap --live`                                   | Uses Stripe live mode instead of test mode. |
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { intro, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { detectOs } from "./lib/os.js";
import {
  confirmResumeSkip,
  parseArgs,
  printSummary,
  recomputeCommandReadiness,
  shouldSkipPhase,
} from "./lib/cold-start.js";
import { runCommand } from "./lib/shell.js";
import { loadReadiness, markPhase, saveReadiness } from "./state.js";
import type { PhaseState } from "./state.js";
import { runInstallPhase } from "./phases/install.js";
import { runAuthPhase } from "./phases/auth.js";
import { runEnvPhase } from "./phases/env.js";
import { runInfraPhase } from "./phases/infra.js";
import { runDatabasePhase } from "./phases/database.js";
import { runProductPhase } from "./products/atlas/bootstrap.js";
import { runDeployPhase } from "./phases/deploy.js";
import { runMcpRegistryPhase } from "./phases/mcp-registry.js";
import { runCiCachePhase } from "./phases/ci-cache.js";
import { runApiDomainPhase } from "./phases/api-domain.js";
import { runApiEdgePhase } from "./phases/api-edge.js";

type BootstrapPhaseStatus = Exclude<PhaseState["status"], "skipped">;

function phaseStatus(
  success: boolean,
  doctorMode: boolean,
): BootstrapPhaseStatus {
  if (success) {
    return "complete";
  }
  return doctorMode ? "partial" : "failed";
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

  // API edge-only mode
  if (args.apiEdgeOnly) {
    log.info(
      `Running atlas-api edge protection only (target=${args.apiDomainTarget}).`,
    );
    const result = await runApiEdgePhase(
      projectRoot,
      args.doctorMode,
      args.apiDomainTarget,
    );
    markPhase(state, "api-edge", result.success ? "complete" : "partial");
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(result.followUpItems.join("\n"), "Follow-up");
    }
    outro(
      result.success
        ? `atlas-api ${args.apiDomainTarget} edge protection ready.`
        : "API edge protection had issues.",
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
      args.stripeTarget,
      args.assumeYes,
    );
    markPhase(state, "product", phaseStatus(result.success, args.doctorMode));
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

  if (args.localOnly) {
    log.step("Phase 4: Stripe Products");
    const result = await runProductPhase(
      projectRoot,
      state,
      args.doctorMode,
      false,
      "local",
      args.assumeYes,
    );
    markPhase(state, "product", phaseStatus(result.success, args.doctorMode));
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
        args.stripeTarget,
        args.assumeYes,
      );
      markPhase(state, "product", phaseStatus(result.success, args.doctorMode));
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

    // Phase 11: API edge protection (Cloudflare proxy + WAF rate limits)
    if (
      !shouldSkipPhase("api-edge", state, args.resume) ||
      !(await confirmResumeSkip("API Edge"))
    ) {
      log.step("Phase 11: API Edge Protection");
      const result = await runApiEdgePhase(projectRoot, args.doctorMode);
      markPhase(state, "api-edge", result.success ? "complete" : "partial");
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
