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
 * | `pnpm bootstrap --ci-cache`                               | Wires Vercel Remote Cache into Actions. |
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
  hasSharedInfraPhases,
  parseArgs,
  printSummary,
  recomputeCommandReadiness,
  shouldBlockCurrentRunDependentPhase,
  shouldStopAfterAuthFailure,
  shouldSkipPhase,
  shouldSkipTargetPhase,
} from "./lib/cold-start.js";
import { runCommand } from "./lib/shell.js";
import {
  getTargetPhase,
  loadReadiness,
  markPhase,
  markTargetPhase,
  saveReadiness,
} from "./state.js";
import type { PhaseId, PhaseResult, PhaseState } from "./state.js";
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
import { renderSetupGuide } from "./config/setup-manifest.js";
import type { HostedDeployTarget } from "./lib/hosted-target.js";

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

function resultPhaseStatus(
  result: PhaseResult,
  doctorMode: boolean,
): PhaseState["status"] {
  return result.status ?? phaseStatus(result.success, doctorMode);
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
  const attemptedPhases = new Set<PhaseId>();

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

  // Infrastructure-only mode
  if (args.infraOnly) {
    const infraTarget =
      args.stripeTarget === "staging" ? "staging" : "production";
    log.info(
      `Running cloud infrastructure setup only (target=${infraTarget}).`,
    );
    log.info(describePhase("Cloud Infrastructure"));
    attemptedPhases.add("infra");
    const result = await runInfraPhase(
      projectRoot,
      state,
      args.doctorMode,
      infraTarget,
      args.assumeYes,
    );
    markTargetPhase(
      state,
      "infra",
      infraTarget,
      resultPhaseStatus(result, args.doctorMode),
    );
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(formatFollowUpNote(result.followUpItems), "Follow-up");
    }
    outro(
      result.success
        ? "Cloud infrastructure setup complete."
        : "Cloud infrastructure setup had issues.",
    );
    return;
  }

  // MCP Registry-only mode
  if (args.mcpRegistryOnly) {
    log.info("Running MCP Registry publisher setup only.");
    log.info(describePhase("MCP Registry Publisher"));
    attemptedPhases.add("mcp-registry");
    const result = await runMcpRegistryPhase(projectRoot, args.doctorMode);
    markPhase(
      state,
      "mcp-registry",
      result.status ?? (result.success ? "complete" : "partial"),
    );
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(formatFollowUpNote(result.followUpItems), "Follow-up");
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
    log.info(describePhase("CI Remote Cache"));
    attemptedPhases.add("ci-cache");
    const result = await runCiCachePhase(projectRoot, args.doctorMode);
    markPhase(
      state,
      "ci-cache",
      result.status ?? (result.success ? "complete" : "partial"),
    );
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(formatFollowUpNote(result.followUpItems), "Follow-up");
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
    const apiDomainHostedTarget: HostedDeployTarget =
      args.apiDomainTarget === "prod" ? "production" : "staging";
    log.info(
      `Running atlas-api domain mapping only (target=${args.apiDomainTarget}).`,
    );
    log.info(describePhase("API Canonical Domain"));
    attemptedPhases.add("api-domain");
    const result = await runApiDomainPhase(
      projectRoot,
      args.doctorMode,
      args.apiDomainTarget,
    );
    markTargetPhase(
      state,
      "api-domain",
      apiDomainHostedTarget,
      result.status ?? (result.success ? "complete" : "partial"),
    );
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(formatFollowUpNote(result.followUpItems), "Follow-up");
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
    const apiEdgeHostedTarget: HostedDeployTarget =
      args.apiDomainTarget === "prod" ? "production" : "staging";
    log.info(
      `Running atlas-api edge protection only (target=${args.apiDomainTarget}).`,
    );
    log.info(describePhase("API Edge Protection"));
    attemptedPhases.add("api-edge");
    const result = await runApiEdgePhase(
      projectRoot,
      args.doctorMode,
      args.apiDomainTarget,
      args.assumeYes,
    );
    markTargetPhase(
      state,
      "api-edge",
      apiEdgeHostedTarget,
      result.status ?? (result.success ? "complete" : "partial"),
    );
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(formatFollowUpNote(result.followUpItems), "Follow-up");
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
    log.info(describePhase("Stripe Products"));
    attemptedPhases.add("product");
    const result = await runProductPhase(
      projectRoot,
      state,
      args.doctorMode,
      args.live,
      args.stripeTarget,
      args.assumeYes,
    );
    markPhase(state, "product", resultPhaseStatus(result, args.doctorMode));
    saveReadiness(projectRoot, state);
    if (result.followUpItems.length > 0) {
      note(formatFollowUpNote(result.followUpItems), "Follow-up");
    }
    outro(result.success ? "Product sync complete." : "Stripe setup pending.");
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
    markPhase(
      state,
      "install",
      result.status ?? (result.success ? "complete" : "partial"),
    );
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
    markPhase(
      state,
      "auth",
      result.status ?? (result.success ? "complete" : "partial"),
    );
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
    markPhase(
      state,
      "env",
      result.status ?? (result.success ? "complete" : "partial"),
    );
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
    // Infra, Database, and Deploy have real per-target readiness: staging
    // and production each get their own GCP project, Neon database, and
    // Cloud Run service (see infra.ts / infra-project.ts / database.ts /
    // deploy.ts). MCP Registry and CI Cache have no staging equivalent by
    // nature — publishing to a public MCP registry and wiring Vercel
    // Remote Cache into CI are prod-only/repo-wide concerns.
    const hostedTarget: HostedDeployTarget =
      args.stripeTarget === "staging" ? "staging" : "production";
    const sharedInfraOnlyPhasesRun = hasSharedInfraPhases(args.stripeTarget);
    if (!sharedInfraOnlyPhasesRun) {
      log.warn(
        "Skipping MCP Registry: it has no staging equivalent — publishing " +
          "to a public MCP registry is a production-only concern. Run " +
          "`pnpm bootstrap --mcp-registry` explicitly if you intend to " +
          "change the shared production listing.",
      );
    }

    // Phase 4: Infrastructure
    if (
      !shouldSkipTargetPhase("infra", hostedTarget, state, args.resume) ||
      !(await confirmResumeSkip(`Infrastructure (${hostedTarget})`))
    ) {
      log.step(`Phase 4: Cloud Infrastructure (${hostedTarget})`);
      log.info(describePhase("Cloud Infrastructure"));
      attemptedPhases.add("infra");
      const result = await runInfraPhase(
        projectRoot,
        state,
        args.doctorMode,
        hostedTarget,
        args.assumeYes,
      );
      markTargetPhase(
        state,
        "infra",
        hostedTarget,
        resultPhaseStatus(result, args.doctorMode),
      );
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 5: Database
    if (
      !shouldSkipTargetPhase("database", hostedTarget, state, args.resume) ||
      !(await confirmResumeSkip(`Database (${hostedTarget})`))
    ) {
      log.step(`Phase 5: Database (${hostedTarget})`);
      log.info(describePhase("Database"));
      attemptedPhases.add("database");
      const result = await runDatabasePhase(
        projectRoot,
        state,
        args.doctorMode,
        hostedTarget,
      );
      markTargetPhase(
        state,
        "database",
        hostedTarget,
        resultPhaseStatus(result, args.doctorMode),
      );
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 6: Product (Stripe)
    if (
      !shouldSkipPhase("product", state, args.resume) ||
      !(await confirmResumeSkip("Product"))
    ) {
      log.step("Phase 6: Stripe Products");
      log.info(describePhase("Stripe Products"));
      attemptedPhases.add("product");
      const result = await runProductPhase(
        projectRoot,
        state,
        args.doctorMode,
        args.live,
        args.stripeTarget,
        args.assumeYes,
      );
      markPhase(state, "product", resultPhaseStatus(result, args.doctorMode));
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 7: MCP Registry publisher (opt-in inside the phase)
    if (
      sharedInfraOnlyPhasesRun &&
      (!shouldSkipPhase("mcp-registry", state, args.resume) ||
        !(await confirmResumeSkip("MCP Registry")))
    ) {
      log.step("Phase 7: MCP Registry Publisher");
      log.info(describePhase("MCP Registry Publisher"));
      attemptedPhases.add("mcp-registry");
      const result = await runMcpRegistryPhase(projectRoot, args.doctorMode);
      markPhase(
        state,
        "mcp-registry",
        result.status ?? (result.success ? "complete" : "partial"),
      );
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 8: Deploy
    if (
      !shouldSkipTargetPhase("deploy", hostedTarget, state, args.resume) ||
      !(await confirmResumeSkip(`Deploy (${hostedTarget})`))
    ) {
      log.step(`Phase 8: Initial Deployment (${hostedTarget})`);
      log.info(describePhase("Initial Deployment"));
      attemptedPhases.add("deploy");
      const result = await runDeployPhase(
        projectRoot,
        state,
        args.doctorMode,
        hostedTarget,
      );
      markTargetPhase(
        state,
        "deploy",
        hostedTarget,
        resultPhaseStatus(result, args.doctorMode),
      );
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 9: CI Remote Cache (Vercel Remote Cache for GitHub Actions)
    if (
      !shouldSkipPhase("ci-cache", state, args.resume) ||
      !(await confirmResumeSkip("CI Cache"))
    ) {
      log.step("Phase 9: CI Remote Cache");
      log.info(describePhase("CI Remote Cache"));
      attemptedPhases.add("ci-cache");
      const result = await runCiCachePhase(projectRoot, args.doctorMode);
      markPhase(
        state,
        "ci-cache",
        result.status ?? (result.success ? "complete" : "partial"),
      );
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 10: API canonical domain (Cloud Run mapping + Cloudflare CNAME)
    if (
      shouldBlockCurrentRunDependentPhase({
        attempted: attemptedPhases.has("deploy"),
        status: getTargetPhase(state, "deploy", hostedTarget)?.status,
      }) &&
      getTargetPhase(state, "api-domain", hostedTarget)?.status !== "complete"
    ) {
      log.step("Phase 10: API Canonical Domain");
      log.error(
        "API domain setup is blocked because atlas-api did not deploy successfully in this run.",
      );
      attemptedPhases.add("api-domain");
      markTargetPhase(
        state,
        "api-domain",
        hostedTarget,
        "blocked",
        "Deploy atlas-api first",
      );
      saveReadiness(projectRoot, state);
      allFollowUp.push(
        "Finish atlas-api deploy, then re-run `pnpm bootstrap --api-domain --resume`.",
      );
    } else if (
      !shouldSkipTargetPhase("api-domain", hostedTarget, state, args.resume) ||
      !(await confirmResumeSkip("API Domain"))
    ) {
      log.step("Phase 10: API Canonical Domain");
      log.info(describePhase("API Canonical Domain"));
      attemptedPhases.add("api-domain");
      const result = await runApiDomainPhase(
        projectRoot,
        args.doctorMode,
        args.apiDomainTarget,
      );
      markTargetPhase(
        state,
        "api-domain",
        hostedTarget,
        result.status ?? (result.success ? "complete" : "partial"),
      );
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }

    // Phase 11: API edge protection (Cloudflare proxy + WAF rate limits)
    if (
      shouldBlockCurrentRunDependentPhase({
        attempted: attemptedPhases.has("api-domain"),
        status: getTargetPhase(state, "api-domain", hostedTarget)?.status,
      }) &&
      getTargetPhase(state, "api-edge", hostedTarget)?.status !== "complete"
    ) {
      log.step("Phase 11: API Edge Protection");
      log.error(
        "API edge protection is blocked because the canonical API domain is not ready yet.",
      );
      attemptedPhases.add("api-edge");
      markTargetPhase(
        state,
        "api-edge",
        hostedTarget,
        "blocked",
        "API domain must be healthy first",
      );
      saveReadiness(projectRoot, state);
      allFollowUp.push(
        "Finish the API domain setup before enabling Cloudflare edge protection.",
      );
    } else if (
      !shouldSkipTargetPhase("api-edge", hostedTarget, state, args.resume) ||
      !(await confirmResumeSkip("API Edge"))
    ) {
      log.step("Phase 11: API Edge Protection");
      log.info(describePhase("API Edge Protection"));
      attemptedPhases.add("api-edge");
      const result = await runApiEdgePhase(
        projectRoot,
        args.doctorMode,
        args.apiDomainTarget,
        args.assumeYes,
      );
      markTargetPhase(
        state,
        "api-edge",
        hostedTarget,
        result.status ?? (result.success ? "complete" : "partial"),
      );
      saveReadiness(projectRoot, state);
      allFollowUp.push(...result.followUpItems);
    }
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
