import path from "node:path";

/**
 * Staging and production bootstrap runs must only ever touch their own
 * hosted resources — GCP project, Cloud Run service, Vercel environment.
 * There is no "both": a staging-targeted run has no business writing to
 * production, and vice versa.
 *
 * This value is deliberately identical to the GitHub Actions Environment
 * name each target's deploy jobs already declare (`environment: staging` /
 * `environment: production` in deploy-staging.yml, deploy-production.yml,
 * api-image-provenance.yml) — no separate translation needed.
 */
export type HostedDeployTarget = "staging" | "production";

export function hostedEnvFilePath(
  projectRoot: string,
  target: HostedDeployTarget,
): string {
  return path.join(
    projectRoot,
    target === "production" ? ".env.production" : ".env.staging",
  );
}
