import type { BootstrapRun } from "./run-context.js";

/** The old hosted bootstrap cannot be used to publish Cloudflare Workers. */
export function runHostedPhases(_run: BootstrapRun): Promise<void> {
  return Promise.reject(
    new Error(
      "Hosted Atlas publication uses Deploy Staging / Deploy Production and pnpm web:doctor; use pnpm setup:local for workstation setup.",
    ),
  );
}
