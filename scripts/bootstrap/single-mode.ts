/**
 * Bootstrap flags that run exactly one phase and stop.
 *
 * Each mode differs only in which phase it runs, how it records the result and
 * what it says at the end, so the modes are rows in a table rather than six
 * copies of the same run-record-report sequence.
 */

import { log, note, outro } from "@clack/prompts";
import { describePhase, formatFollowUpNote } from "./lib/cold-start.js";
import type { HostedDeployTarget } from "./lib/hosted-target.js";
import { runApiDomainPhase } from "./phases/api-domain.js";
import { runApiEdgePhase } from "./phases/api-edge.js";
import { runCiCachePhase } from "./phases/ci-cache.js";
import { runInfraPhase } from "./phases/infra.js";
import { runMcpRegistryPhase } from "./phases/mcp-registry.js";
import { runProductPhase } from "./products/atlas/bootstrap.js";
import {
  reportedPhaseStatus,
  resultPhaseStatus,
  type BootstrapRun,
} from "./run-context.js";
import { markPhase, markTargetPhase, saveReadiness } from "./state.js";
import type { PhaseResult } from "./state.js";

interface SingleMode {
  announcement: string;
  phaseLabel: string;
  run: () => Promise<PhaseResult>;
  record: (result: PhaseResult) => void;
  successMessage: string;
  failureMessage: string;
}

/**
 * Return the single phase these flags ask for, or null for a full run.
 *
 * @param run - The invocation's arguments, project root and readiness state.
 */
export function selectSingleMode(run: BootstrapRun): SingleMode | null {
  const { args, projectRoot, state } = run;
  const hostedApiTarget: HostedDeployTarget =
    args.apiDomainTarget === "prod" ? "production" : "staging";

  if (args.infraOnly) {
    const infraTarget =
      args.stripeTarget === "staging" ? "staging" : "production";
    return {
      announcement: `Running cloud infrastructure setup only (target=${infraTarget}).`,
      phaseLabel: "Cloud Infrastructure",
      run: () =>
        runInfraPhase(
          projectRoot,
          state,
          args.doctorMode,
          infraTarget,
          args.assumeYes,
        ),
      record: (result) => {
        markTargetPhase(
          state,
          "infra",
          infraTarget,
          resultPhaseStatus(result, args.doctorMode),
        );
      },
      successMessage: "Cloud infrastructure setup complete.",
      failureMessage: "Cloud infrastructure setup had issues.",
    };
  }
  if (args.mcpRegistryOnly) {
    return {
      announcement: "Running MCP Registry publisher setup only.",
      phaseLabel: "MCP Registry Publisher",
      run: () => runMcpRegistryPhase(projectRoot, args.doctorMode),
      record: (result) => {
        markPhase(state, "mcp-registry", reportedPhaseStatus(result));
      },
      successMessage: "MCP Registry publisher setup complete.",
      failureMessage: "MCP Registry publisher setup had issues.",
    };
  }
  if (args.ciCacheOnly) {
    return {
      announcement: "Running Vercel Remote Cache wiring only.",
      phaseLabel: "CI Remote Cache",
      run: () => runCiCachePhase(projectRoot, args.doctorMode),
      record: (result) => {
        markPhase(state, "ci-cache", reportedPhaseStatus(result));
      },
      successMessage: "Vercel Remote Cache wired into GitHub Actions.",
      failureMessage: "CI cache wiring had issues.",
    };
  }
  if (args.apiDomainOnly) {
    return {
      announcement: `Running atlas-api domain mapping only (target=${args.apiDomainTarget}).`,
      phaseLabel: "API Canonical Domain",
      run: () =>
        runApiDomainPhase(projectRoot, args.doctorMode, args.apiDomainTarget),
      record: (result) => {
        markTargetPhase(
          state,
          "api-domain",
          hostedApiTarget,
          reportedPhaseStatus(result),
        );
      },
      successMessage: `atlas-api ${args.apiDomainTarget} canonical domain ready.`,
      failureMessage: "API domain wiring had issues.",
    };
  }
  if (args.apiEdgeOnly) {
    return {
      announcement: `Running atlas-api edge protection only (target=${args.apiDomainTarget}).`,
      phaseLabel: "API Edge Protection",
      run: () =>
        runApiEdgePhase(
          projectRoot,
          args.doctorMode,
          args.apiDomainTarget,
          args.assumeYes,
        ),
      record: (result) => {
        markTargetPhase(
          state,
          "api-edge",
          hostedApiTarget,
          reportedPhaseStatus(result),
        );
      },
      successMessage: `atlas-api ${args.apiDomainTarget} edge protection ready.`,
      failureMessage: "API edge protection had issues.",
    };
  }
  if (args.productOnly === "atlas") {
    return {
      announcement: "Running Stripe product sync only.",
      phaseLabel: "Stripe Products",
      run: () =>
        runProductPhase(
          projectRoot,
          state,
          args.doctorMode,
          args.live,
          args.stripeTarget,
          args.assumeYes,
        ),
      record: (result) => {
        markPhase(state, "product", resultPhaseStatus(result, args.doctorMode));
      },
      successMessage: "Product sync complete.",
      failureMessage: "Stripe setup pending.",
    };
  }
  return null;
}

/**
 * Run one selected phase, record it, and end the invocation's output.
 *
 * @param run - The invocation the mode belongs to.
 * @param mode - The phase to run, from selectSingleMode.
 */
export async function runSingleMode(
  run: BootstrapRun,
  mode: SingleMode,
): Promise<void> {
  log.info(mode.announcement);
  log.info(describePhase(mode.phaseLabel));
  const result = await mode.run();
  mode.record(result);
  saveReadiness(run.projectRoot, run.state);
  if (result.followUpItems.length > 0) {
    note(formatFollowUpNote(result.followUpItems), "Follow-up");
  }
  outro(result.success ? mode.successMessage : mode.failureMessage);
}
