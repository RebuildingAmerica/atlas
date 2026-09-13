/**
 * What one bootstrap invocation carries from phase to phase.
 *
 * The entry point runs main() as soon as it is imported, so anything the phase
 * runners share has to live here rather than in cold-start.ts.
 */

import type { CliArgs } from "./lib/cold-start.js";
import type {
  PhaseId,
  PhaseResult,
  PhaseState,
  ReadinessState,
} from "./state.js";

export interface BootstrapRun {
  projectRoot: string;
  args: CliArgs;
  state: ReadinessState;
  allFollowUp: string[];
  attemptedPhases: Set<PhaseId>;
}

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

/**
 * The status to record for a phase whose failure means real work is undone.
 *
 * A doctor run changes nothing, so a failed check there is partial rather
 * than failed.
 */
export function resultPhaseStatus(
  result: PhaseResult,
  doctorMode: boolean,
): PhaseState["status"] {
  return result.status ?? phaseStatus(result.success, doctorMode);
}

/** The status a phase reports for itself, or partial when it reports none. */
export function reportedPhaseStatus(result: PhaseResult): PhaseState["status"] {
  return result.status ?? (result.success ? "complete" : "partial");
}
