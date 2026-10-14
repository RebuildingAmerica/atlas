import type { PhaseResult } from "../state.js";

export type ApiDomainTarget = "prod" | "staging";

/** Legacy entrypoint retained only to fail safely for existing callers. */
export function runApiDomainPhase(
  _projectRoot: string,
  _doctorMode: boolean,
  _target: ApiDomainTarget = "prod",
): Promise<PhaseResult> {
  return Promise.resolve({
    success: false,
    status: "blocked",
    followUpItems: [
      "The Cloud Run API domain mapping is retired. Use Deploy Staging / Deploy Production and pnpm web:doctor.",
    ],
  });
}
