import { text } from "@clack/prompts";
import { mergeEnvFile, parseEnvFile } from "../lib/env-file.js";
import { promptOrExit } from "../lib/ui.js";
import { isPlaceholder } from "../lib/secret.js";
import type { VercelEnvironment, VercelVar } from "../lib/vercel.js";

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

export function buildVercelEnvVars(env: Map<string, string>): VercelVar[] {
  const all: VercelEnvironment[] = ["production", "preview", "development"];
  const prod: VercelEnvironment[] = ["production"];

  function get(key: string, fallback?: string): string | undefined {
    const v = env.get(key);
    return v !== undefined && !isPlaceholder(v) ? v : fallback;
  }

  const vars: VercelVar[] = [];
  function add(
    key: string,
    value: string | undefined,
    environments: VercelEnvironment[],
  ): void {
    if (value) vars.push({ key, value, environments });
  }

  add("NITRO_PRESET", "vercel", all);
  add("ATLAS_AUTH_BASE_PATH", get("ATLAS_AUTH_BASE_PATH", "/api/auth"), all);
  add("ATLAS_DEPLOY_MODE", "local", ["preview"]);
  add("ATLAS_PUBLIC_URL", get("ATLAS_PUBLIC_URL"), prod);
  add("ATLAS_DOCS_URL", get("ATLAS_DOCS_URL"), prod);
  add(
    "ATLAS_SERVER_API_PROXY_TARGET",
    get("ATLAS_SERVER_API_PROXY_TARGET"),
    prod,
  );
  add("ATLAS_MAP_STYLE_URL", get("ATLAS_MAP_STYLE_URL"), prod);
  add("ATLAS_AUTH_JWT_AUDIENCES", get("ATLAS_AUTH_JWT_AUDIENCES"), prod);
  add("ATLAS_EMAIL_PROVIDER", get("ATLAS_EMAIL_PROVIDER", "resend"), prod);
  add("ATLAS_AUTH_INTERNAL_SECRET", get("ATLAS_AUTH_INTERNAL_SECRET"), prod);
  add("ATLAS_EMAIL_RESEND_API_KEY", get("ATLAS_EMAIL_RESEND_API_KEY"), prod);
  add("ATLAS_EMAIL_FROM", get("ATLAS_EMAIL_FROM"), prod);
  add(
    "ATLAS_OPERATOR_ALLOWED_EMAILS",
    get("ATLAS_OPERATOR_ALLOWED_EMAILS"),
    prod,
  );
  add(
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
    get("ATLAS_AUTH_API_KEY_INTROSPECTION_URL"),
    prod,
  );

  return vars;
}
