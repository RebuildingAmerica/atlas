import { note, text } from "@clack/prompts";
import { mergeEnvFile, parseEnvFile } from "../lib/env-file.js";
import { promptOrExit } from "../lib/ui.js";
import { isPlaceholder } from "../lib/secret.js";
import type { VercelEnvironment, VercelVar } from "../lib/vercel.js";

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

export async function ensureProductionRoutingConfig(
  prodEnvPath: string,
  followUpItems: string[],
): Promise<void> {
  const prodEnv = parseEnvFile(prodEnvPath);
  const updates = new Map<string, string>();

  let resolvedPublicUrl = prodEnv.get("ATLAS_PUBLIC_URL")?.trim();
  if (!resolvedPublicUrl) {
    note(
      "Atlas needs its public production origin so Vercel, Cloud Run, auth, and Mintlify all agree on the same site URL.",
      "Production app URL",
    );
    const value = (await promptOrExit(
      text({
        message: "Production Atlas URL",
        placeholder: "https://atlas.rebuildingus.org",
        validate: (input) => {
          const value = input ?? "";
          if (!value.trim()) return "The production Atlas URL is required.";
          try {
            normalizeHostedHttpsOrigin(value, "ATLAS_PUBLIC_URL");
          } catch (error) {
            return error instanceof Error
              ? error.message
              : "Enter a valid HTTPS Atlas URL.";
          }
        },
      }),
    )) as string;
    resolvedPublicUrl = normalizeHostedHttpsOrigin(value, "ATLAS_PUBLIC_URL");
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
    note(
      "The Vercel app uses this HTTPS origin to proxy browser-visible API and MCP traffic to Cloud Run.",
      "Atlas API proxy origin",
    );
    const value = (await promptOrExit(
      text({
        message: "Public Atlas API origin",
        placeholder: "https://atlas-api.rebuildingus.org",
        validate: (input) => {
          const value = input ?? "";
          if (!value.trim()) return "The public Atlas API origin is required.";
          try {
            normalizeHostedHttpsOrigin(value, "ATLAS_SERVER_API_PROXY_TARGET");
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
      normalizeHostedHttpsOrigin(value, "ATLAS_SERVER_API_PROXY_TARGET"),
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
    note(
      "Mintlify's Vercel subpath setup needs the Mintlify deployment origin, usually https://<subdomain>.mintlify.dev. Bootstrap will sync this to Vercel, but you still need to enable Mintlify's 'Host at /docs' setting in the dashboard.",
      "Mintlify docs origin",
    );
    const value = (await promptOrExit(
      text({
        message: "Mintlify docs origin",
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
  add("ATLAS_AUTH_ALLOWED_EMAILS", get("ATLAS_AUTH_ALLOWED_EMAILS"), prod);
  add(
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
    get("ATLAS_AUTH_API_KEY_INTROSPECTION_URL"),
    prod,
  );

  return vars;
}
