import type { PhaseResult } from "../state.js";
import type { ApiDomainTarget } from "./api-domain.js";

/** Legacy entrypoint retained only to fail safely for existing callers. */
export function runApiEdgePhase(
  _projectRoot: string,
  _doctorMode: boolean,
  _target: ApiDomainTarget = "prod",
  _assumeYes = false,
): Promise<PhaseResult> {
  return Promise.resolve({
    success: false,
    status: "blocked",
    followUpItems: [
      "The Cloud Run edge setup is retired. Use Deploy Staging / Deploy Production and pnpm web:doctor.",
    ],
  });
}
