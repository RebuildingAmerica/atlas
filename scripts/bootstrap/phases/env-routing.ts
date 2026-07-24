import { text } from "@clack/prompts";
import { mergeEnvFile, parseEnvFile } from "../lib/env-file.js";
import { promptOrExit } from "../lib/ui.js";
import { isPlaceholder } from "../lib/secret.js";
import type { VercelEnvironment, VercelVar } from "../lib/vercel.js";

/**
 * Staging and prod bootstrap runs must only ever touch their own Vercel
 * environment. There is no "both" — a staging-targeted run has no business
 * writing to Production, and vice versa.
 */
export type HostedDeployTarget = "staging" | "prod";

export function vercelEnvironmentsForTarget(
  target: HostedDeployTarget,
): VercelEnvironment[] {
  return target === "prod" ? ["production", "development"] : ["preview"];
}

export const DEFAULT_PRODUCTION_APP_ORIGIN = "https://atlas.rebuildingus.org";
export const DEFAULT_PRODUCTION_API_ORIGIN =
  "https://atlas-api.rebuildingus.org";

export function normalizeDocsOrigin(value: string): string {
  const candidate = value.trim();
  const normalizedCandidate = /^https?:\/\//.test(candidate)
    ? candidate
    : `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(normalizedCandidate);
  } catch {
    throw new Error("Enter a valid Mintlify hostname or URL.");
  }

  if (!/^https?:$/.test(url.protocol) || !url.hostname) {
    throw new Error("Enter a valid Mintlify hostname or URL.");
  }

  return url.origin;
}

export function normalizeHostedHttpsOrigin(
  value: string,
  label: string,
): string {
  const candidate = value.trim();
  const normalizedCandidate = /^https?:\/\//.test(candidate)
    ? candidate
    : `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(normalizedCandidate);
  } catch {
    throw new Error(`${label} must be a valid URL or hostname.`);
  }

  if (url.protocol !== "https:" || !url.hostname) {
    throw new Error(`${label} must use https:// for hosted deployments.`);
  }

  return url.origin;
}

export function resolveHostedOriginPromptValue(
  input: string,
  fallback: string,
  label: string,
): string {
  const candidate = input.trim() || fallback;
  return normalizeHostedHttpsOrigin(candidate, label);
}

export function formatProductionAppUrlPromptMessage(): string {
  return [
    "Production Atlas URL",
    "",
    "Use the public HTTPS origin for the Atlas web app.",
    "1. Open the Vercel project that serves Atlas production.",
    "2. Copy the production domain, including https://.",
    "3. Use https://atlas.rebuildingus.org unless production is intentionally on another domain.",
    "",
    "Press Enter to accept the shown default. Bootstrap writes this to ATLAS_PUBLIC_URL.",
  ].join("\n");
}

export function formatProductionApiProxyPromptMessage(): string {
  return [
    "Public Atlas API origin",
    "",
    "Use the public HTTPS origin that the Vercel app should proxy /api traffic to.",
    "1. Prefer the canonical API domain after Cloud Run domain setup: https://atlas-api.rebuildingus.org.",
    "2. If the canonical domain is not ready yet, use the current Cloud Run service URL.",
    "3. Do not paste a path; this value must be only the origin.",
    "",
    "Press Enter to accept the shown default. Bootstrap writes this to ATLAS_SERVER_API_PROXY_TARGET.",
  ].join("\n");
}

export function formatMintlifyDocsOriginPromptMessage(): string {
  return [
    "Mintlify docs origin",
    "",
    "Use the Mintlify deployment origin that Vercel should serve at /docs.",
    "1. Open the Mintlify project dashboard.",
    "2. Copy the deployment origin, usually https://<subdomain>.mintlify.dev.",
    "3. After bootstrap, enable Mintlify's Host at /docs setting for the Atlas domain.",
    "",
    "Paste the Mintlify origin here. Bootstrap writes this to ATLAS_DOCS_URL.",
  ].join("\n");
}

export async function ensureProductionRoutingConfig(
  prodEnvPath: string,
  followUpItems: string[],
): Promise<void> {
  const prodEnv = parseEnvFile(prodEnvPath);
  const updates = new Map<string, string>();

  let resolvedPublicUrl = prodEnv.get("ATLAS_PUBLIC_URL")?.trim();
  if (!resolvedPublicUrl) {
    const value = (await promptOrExit(
      text({
        message: formatProductionAppUrlPromptMessage(),
        initialValue: DEFAULT_PRODUCTION_APP_ORIGIN,
        validate: (input) => {
          const value = input ?? "";
          try {
            resolveHostedOriginPromptValue(
              value,
              DEFAULT_PRODUCTION_APP_ORIGIN,
              "ATLAS_PUBLIC_URL",
            );
          } catch (error) {
            return error instanceof Error
              ? error.message
              : "Enter a valid HTTPS Atlas URL.";
          }
        },
      }),
    )) as string;
    resolvedPublicUrl = resolveHostedOriginPromptValue(
      value,
      DEFAULT_PRODUCTION_APP_ORIGIN,
      "ATLAS_PUBLIC_URL",
    );
    updates.set("ATLAS_PUBLIC_URL", resolvedPublicUrl);
  }

  const apiProxyTarget = prodEnv.get("ATLAS_SERVER_API_PROXY_TARGET")?.trim();
  if (apiProxyTarget) {
    const normalizedApiProxyTarget = normalizeHostedHttpsOrigin(
      apiProxyTarget,
      "ATLAS_SERVER_API_PROXY_TARGET",
    );
    if (normalizedApiProxyTarget !== apiProxyTarget) {
      updates.set("ATLAS_SERVER_API_PROXY_TARGET", normalizedApiProxyTarget);
    }
  } else {
    const value = (await promptOrExit(
      text({
        message: formatProductionApiProxyPromptMessage(),
        initialValue: DEFAULT_PRODUCTION_API_ORIGIN,
        validate: (input) => {
          const value = input ?? "";
          try {
            resolveHostedOriginPromptValue(
              value,
              DEFAULT_PRODUCTION_API_ORIGIN,
              "ATLAS_SERVER_API_PROXY_TARGET",
            );
          } catch (error) {
            return error instanceof Error
              ? error.message
              : "Enter a valid HTTPS API origin.";
          }
        },
      }),
    )) as string;
    updates.set(
      "ATLAS_SERVER_API_PROXY_TARGET",
      resolveHostedOriginPromptValue(
        value,
        DEFAULT_PRODUCTION_API_ORIGIN,
        "ATLAS_SERVER_API_PROXY_TARGET",
      ),
    );
  }

  if (resolvedPublicUrl) {
    const normalizedPublicUrl = normalizeHostedHttpsOrigin(
      resolvedPublicUrl,
      "ATLAS_PUBLIC_URL",
    );
    if (normalizedPublicUrl !== resolvedPublicUrl) {
      updates.set("ATLAS_PUBLIC_URL", normalizedPublicUrl);
    }
  }

  const docsUrl = prodEnv.get("ATLAS_DOCS_URL")?.trim();
  const normalizedDocsUrl = docsUrl ? normalizeDocsOrigin(docsUrl) : undefined;
  if (normalizedDocsUrl && normalizedDocsUrl !== docsUrl) {
    updates.set("ATLAS_DOCS_URL", normalizedDocsUrl);
  }

  if (!normalizedDocsUrl) {
    const value = (await promptOrExit(
      text({
        message: formatMintlifyDocsOriginPromptMessage(),
        placeholder: "https://your-subdomain.mintlify.dev",
        validate: (input) => {
          const value = input ?? "";
          if (!value.trim()) return "The Mintlify docs origin is required.";
          try {
            normalizeDocsOrigin(value);
          } catch (error) {
            return error instanceof Error
              ? error.message
              : "Enter a valid Mintlify hostname or URL.";
          }
        },
      }),
    )) as string;
    updates.set("ATLAS_DOCS_URL", normalizeDocsOrigin(value));
  }

  if (updates.size > 0) {
    mergeEnvFile(prodEnvPath, updates);
  }

  followUpItems.push(
    "In Mintlify, enable 'Host at /docs' for the Atlas domain so Vercel rewrites can proxy /docs correctly.",
  );
}

interface VercelStaticEnvSpec {
  key: string;
  value: string;
  environments: VercelEnvironment[];
}

interface VercelEnvFileSpec {
  key: string;
  fallback?: string;
}

export function buildVercelEnvVars(
  target: HostedDeployTarget,
  productionEnv: Map<string, string>,
  stagingEnv: Map<string, string> = productionEnv,
): VercelVar[] {
  const allowedEnvironments = new Set(vercelEnvironmentsForTarget(target));

  const vars: VercelVar[] = [];
  const add = (
    key: string,
    value: string | undefined,
    environments: VercelEnvironment[],
  ): void => {
    const scoped = environments.filter((env) => allowedEnvironments.has(env));
    if (value && scoped.length > 0) {
      vars.push({ key, value, environments: scoped });
    }
  };

  for (const spec of getVercelStaticEnvSpecs(productionEnv)) {
    add(spec.key, spec.value, spec.environments);
  }

  for (const spec of VERCEL_HOSTED_ENV_FILE_SPECS) {
    if (target === "prod") {
      add(spec.key, readEnvValue(productionEnv, spec.key, spec.fallback), [
        "production",
      ]);
    } else {
      add(spec.key, readEnvValue(stagingEnv, spec.key, spec.fallback), [
        "preview",
      ]);
    }
  }

  return vars;
}

function readEnvValue(
  env: Map<string, string>,
  key: string,
  fallback?: string,
): string | undefined {
  const value = env.get(key);
  return value !== undefined && !isPlaceholder(value) ? value : fallback;
}

function getVercelStaticEnvSpecs(
  productionEnv: Map<string, string>,
): VercelStaticEnvSpec[] {
  const all: VercelEnvironment[] = ["production", "preview", "development"];
  return [
    { key: "NITRO_PRESET", value: "vercel", environments: all },
    {
      key: "ATLAS_AUTH_BASE_PATH",
      value:
        readEnvValue(productionEnv, "ATLAS_AUTH_BASE_PATH", "/api/auth") ??
        "/api/auth",
      environments: all,
    },
    {
      key: "ATLAS_DEPLOY_MODE",
      value: "production",
      environments: ["production"],
    },
    { key: "ATLAS_DEPLOY_MODE", value: "staging", environments: ["preview"] },
    {
      key: "ATLAS_DEPLOY_MODE",
      value: "local",
      environments: ["development"],
    },
  ];
}

const VERCEL_HOSTED_ENV_FILE_SPECS: VercelEnvFileSpec[] = [
  { key: "DATABASE_BACKEND", fallback: "postgres" },
  { key: "DATABASE_URL" },
  { key: "ATLAS_PUBLIC_URL" },
  { key: "ATLAS_PDS_PUBLIC_URL" },
  { key: "ATLAS_DOCS_URL" },
  { key: "ATLAS_SERVER_API_PROXY_TARGET" },
  { key: "ATLAS_AUTH_JWT_AUDIENCES" },
  { key: "ATLAS_EMAIL_PROVIDER", fallback: "resend" },
  { key: "ATLAS_AUTH_INTERNAL_SECRET" },
  { key: "ATLAS_EMAIL_RESEND_API_KEY" },
  { key: "ATLAS_EMAIL_FROM" },
  { key: "ATLAS_OPERATOR_ALLOWED_EMAILS" },
  { key: "ATLAS_AUTH_API_KEY_INTROSPECTION_URL" },
  { key: "ATLAS_AUTH_MEMBERSHIP_URL" },
];
