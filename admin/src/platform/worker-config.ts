/**
 * The Worker's deployment settings, following the org standard for internal
 * apps (docs/standards/internal-apps.md), in the `cf` config format.
 *
 * The admin is reachable only at its own hostname, behind Cloudflare Access.
 * There is no `workers.dev` address and no preview URL, so Access is the only
 * way in. Every page and server function also passes the Worker's own check
 * of the Access assertion. The built client bundle under `/assets/` is the
 * one exception: it is served straight from static assets, holds code only,
 * no data, and Access still gates it at the edge.
 */

interface AdminBuildEnv {
  ATLAS_ADMIN_PUBLIC_URL?: string;
  ATLAS_ADMIN_DEPLOY_ENVIRONMENT?: string;
}

interface AdminBuildContext {
  mode: string | undefined;
}

interface SecretBinding {
  type: "secret";
}

/**
 * Every setting the admin reads. Each is a secret binding: the deploy job
 * uploads the values with `cf deploy --secrets-file`, and `vite dev` reads them
 * from a gitignored `.dev.vars`. A Worker deployed without one refuses every
 * request with a 503.
 */
export const ADMIN_SETTINGS = [
  "ATLAS_ACCESS_AUD",
  "ATLAS_ACCESS_TEAM_DOMAIN",
  "ATLAS_ADMIN_PUBLIC_URL",
  "ATLAS_ADMIN_SIGNING_KEY",
  "ATLAS_API_URL",
  "ATLAS_PLATFORM_OPERATOR_EMAILS",
] as const;

/** Read only by `vite dev`; refused anywhere else. */
export const ADMIN_DEVELOPMENT_SETTINGS = [
  "ATLAS_ADMIN_DEV_OPERATOR_EMAIL",
] as const;

export interface AdminWorkerConfig {
  name: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
  entrypoint: string;
  workersDev: false;
  previewUrls: false;
  domains: string[];
  assets: { runWorkerFirst: string[] };
  observability: { enabled: true; logs: { invocationLogs: false } };
  env: Record<string, SecretBinding>;
}

function secretBindings(
  names: readonly string[],
): Record<string, SecretBinding> {
  return Object.fromEntries(names.map((name) => [name, { type: "secret" }]));
}

export const ADMIN_WORKER_NAME = "atlas-admin";
export const ADMIN_COMPATIBILITY_DATE = "2026-09-25";

const ADMIN_DEPLOYMENTS = {
  production: {
    name: ADMIN_WORKER_NAME,
    hostname: "atlas-admin.rebuildingus.org",
  },
  staging: {
    name: "atlas-admin-staging",
    hostname: "atlas-admin-staging.rebuildingus.org",
  },
} as const;

function deployment(env: AdminBuildEnv): { name: string; hostname: string } {
  const target = env.ATLAS_ADMIN_DEPLOY_ENVIRONMENT;
  if (target !== "production" && target !== "staging") {
    throw new Error(
      "ATLAS_ADMIN_DEPLOY_ENVIRONMENT must be production or staging.",
    );
  }
  const config = ADMIN_DEPLOYMENTS[target];
  if (adminHostname(env.ATLAS_ADMIN_PUBLIC_URL) !== config.hostname) {
    throw new Error(
      `ATLAS_ADMIN_PUBLIC_URL does not match the ${target} admin hostname.`,
    );
  }
  return config;
}

/**
 * Returns the hostname the admin is served at, from `ATLAS_ADMIN_PUBLIC_URL`.
 *
 * @param publicUrl - The admin's public origin, e.g. `https://atlas-admin.rebuildingus.org`.
 * @throws When the value is missing, not https, or carries a path.
 */
export function adminHostname(publicUrl: string | undefined): string {
  const value = publicUrl?.trim();
  if (!value) {
    throw new Error(
      "ATLAS_ADMIN_PUBLIC_URL is required to build the platform admin.",
    );
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "ATLAS_ADMIN_PUBLIC_URL must be an https origin with no path.",
    );
  }
  return url.hostname;
}

/**
 * Builds the Worker config. A production build is published to the admin's
 * own hostname and nowhere else; local development has no hostname.
 *
 * @param env - Build-time origin and explicit deployment environment.
 * @param context - The mode `cf` or Vite evaluates the config in.
 */
export function adminWorkerConfig(
  env: AdminBuildEnv,
  { mode }: AdminBuildContext,
): AdminWorkerConfig {
  const development = mode === "development";
  // Separate Workers and hostnames keep staging releases from replacing the
  // live operator tools or their production signing key and API bindings.
  const target = development ? null : deployment(env);
  return {
    name: target ? target.name : ADMIN_WORKER_NAME,
    compatibilityDate: ADMIN_COMPATIBILITY_DATE,
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "@tanstack/react-start/server-entry",
    workersDev: false,
    previewUrls: false,
    domains: target ? [target.hostname] : [],
    assets: { runWorkerFirst: ["/*", "!/assets/*"] },
    // Tokenized URLs must not end up in Cloudflare's request logs.
    observability: { enabled: true, logs: { invocationLogs: false } },
    env: secretBindings(
      development
        ? [...ADMIN_SETTINGS, ...ADMIN_DEVELOPMENT_SETTINGS]
        : ADMIN_SETTINGS,
    ),
  };
}
