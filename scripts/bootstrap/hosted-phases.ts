/**
 * The phases a hosted bootstrap runs after the shared local setup.
 *
 * Infrastructure, database and deploy have real per-target readiness, since
 * staging and production each get their own GCP project, Neon database and
 * Cloud Run service. MCP Registry and CI cache are repo-wide concerns with no
 * staging equivalent.
 */

import { log } from "@clack/prompts";
import {
  confirmResumeSkip,
  describePhase,
  hasSharedInfraPhases,
  shouldBlockCurrentRunDependentPhase,
  shouldSkipPhase,
  shouldSkipTargetPhase,
} from "./lib/cold-start.js";
import {
  getTargetPhase,
  markPhase,
  markTargetPhase,
  saveReadiness,
} from "./state.js";
import { runInfraPhase } from "./phases/infra.js";
import { runDatabasePhase } from "./phases/database.js";
import { runProductPhase } from "./products/atlas/bootstrap.js";
import { runDeployPhase } from "./phases/deploy.js";
import { runMcpRegistryPhase } from "./phases/mcp-registry.js";
import { runCiCachePhase } from "./phases/ci-cache.js";
import { runApiDomainPhase } from "./phases/api-domain.js";
import { runApiEdgePhase } from "./phases/api-edge.js";
import type { HostedDeployTarget } from "./lib/hosted-target.js";

import {
  reportedPhaseStatus,
  resultPhaseStatus,
  type BootstrapRun,
} from "./run-context.js";

/**
 * Run every hosted phase the resume state and target call for.
 *
 * @param run - The invocation's arguments, readiness state and follow-ups.
 */
export async function runHostedPhases(run: BootstrapRun): Promise<void> {
  const { projectRoot, args, state, allFollowUp, attemptedPhases } = run;
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
    markPhase(state, "mcp-registry", reportedPhaseStatus(result));
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
    markPhase(state, "ci-cache", reportedPhaseStatus(result));
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
      reportedPhaseStatus(result),
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
      reportedPhaseStatus(result),
    );
    saveReadiness(projectRoot, state);
    allFollowUp.push(...result.followUpItems);
  }
}
