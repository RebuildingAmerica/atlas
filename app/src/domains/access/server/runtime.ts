import "@tanstack/react-start/server-only";

import path from "node:path";

/**
 * Runtime configuration needed to enforce Atlas auth behavior on the app
 * server.
 */
export interface AuthRuntimeConfig {
  apiAudience: string | null;
  apiKeyIntrospectionUrl: string | null;
  allowedEmails: Set<string>;
  apiBaseUrl: string | null;
  databaseUrl: string | null;
  localMode: boolean;
  openRegistration: boolean;
  captureUrl: string | null;
  dbPath: string;
  emailFrom: string;
  emailProvider: "capture" | "resend";
  internalSecret: string;
  publicBaseUrl: string;
  publicDomain: string;
  resendApiKey: string | null;
}

/**
 * Removes trailing slashes so URLs compose predictably.
 */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Produces the session-only header subset expected by Better Auth.
 *
 * This is the key boundary helper that strips API-key and internal-trust
 * headers so browser-session flows cannot be authenticated by other means.
 */
export function sanitizeBrowserSessionHeaders(headers: Headers): Headers {
  const sanitized = new Headers();
  const cookie = headers.get("cookie");
  if (cookie) {
    sanitized.set("cookie", cookie);
  }
  return sanitized;
}

/**
 * Parses the optional allowlist env var into a normalized email set.
 */
function normalizeEmailList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function resolveEmailProvider(env: NodeJS.ProcessEnv): "capture" | "resend" {
  const configuredProvider = env.ATLAS_EMAIL_PROVIDER?.trim().toLowerCase();
  if (configuredProvider === "resend") {
    return "resend";
  }

  if (configuredProvider === "capture") {
    return "capture";
  }

  if (env.ATLAS_EMAIL_RESEND_API_KEY?.trim()) {
    return "resend";
  }

  return "capture";
}

function resolveApiKeyIntrospectionUrl(env: NodeJS.ProcessEnv): string | null {
  const configuredUrl = env.ATLAS_AUTH_API_KEY_INTROSPECTION_URL?.trim();
  if (!configuredUrl) {
    return null;
  }

  try {
    return new URL(configuredUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Resolves the direct API origin when the app proxies Atlas API
 * traffic to a separate service.
 *
 * @param env - The current process environment.
 */
function resolveApiBaseUrl(env: NodeJS.ProcessEnv): string | null {
  const configuredUrl = env.ATLAS_SERVER_API_PROXY_TARGET?.trim();
  if (!configuredUrl) {
    return null;
  }

  try {
    return trimTrailingSlash(new URL(configuredUrl).toString());
  } catch {
    return null;
  }
}

/**
 * Resolves auth runtime config from the process environment.
 */
export function resolveAuthRuntimeConfig(env: NodeJS.ProcessEnv, cwd: string): AuthRuntimeConfig {
  const configuredPublicUrl = env.ATLAS_PUBLIC_URL?.trim();
  if (!configuredPublicUrl) {
    throw new Error("ATLAS_PUBLIC_URL is required.");
  }

  const publicBaseUrl = trimTrailingSlash(configuredPublicUrl);
  const publicDomain = new URL(publicBaseUrl).hostname;
  const localMode = env.ATLAS_DEPLOY_MODE === "local";
  const emailProvider = resolveEmailProvider(env);

  const databaseUrl = env.DATABASE_URL?.trim() || null;

  return {
    apiAudience: env.ATLAS_API_AUDIENCE?.trim() || null,
    apiBaseUrl: resolveApiBaseUrl(env),
    apiKeyIntrospectionUrl: resolveApiKeyIntrospectionUrl(env),
    allowedEmails: normalizeEmailList(env.ATLAS_AUTH_ALLOWED_EMAILS),
    databaseUrl,
    localMode,
    openRegistration: env.ATLAS_AUTH_OPEN_REGISTRATION !== "false",
    captureUrl: env.ATLAS_EMAIL_CAPTURE_URL?.trim() || null,
    dbPath: env.ATLAS_AUTH_DB_PATH?.trim() || path.join(cwd, "data", "auth", "atlas-auth.sqlite"),
    emailFrom: env.ATLAS_EMAIL_FROM?.trim() || `Atlas <noreply@${publicDomain}>`,
    emailProvider,
    internalSecret: env.ATLAS_AUTH_INTERNAL_SECRET?.trim() || "",
    publicBaseUrl,
    publicDomain,
    resendApiKey: env.ATLAS_EMAIL_RESEND_API_KEY?.trim() || null,
  };
}

let _cachedConfig: AuthRuntimeConfig | null = null;

/**
 * Returns the current process auth runtime config (cached after first call).
 */
export function getAuthRuntimeConfig(): AuthRuntimeConfig {
  if (!_cachedConfig) {
    _cachedConfig = resolveAuthRuntimeConfig(process.env, process.cwd());
  }
  return _cachedConfig;
}

/**
 * Fails fast when an auth-enabled deployment is missing required config.
 */
export function validateAuthRuntimeConfig(runtime: AuthRuntimeConfig): void {
  if (!runtime.internalSecret) {
    throw new Error("ATLAS_AUTH_INTERNAL_SECRET is required.");
  }

  if (runtime.localMode) {
    return;
  }

  if (!runtime.apiKeyIntrospectionUrl) {
    throw new Error(
      "ATLAS_AUTH_API_KEY_INTROSPECTION_URL is required when ATLAS_DEPLOY_MODE is not local.",
    );
  }

  if (runtime.emailProvider === "resend" && !runtime.resendApiKey) {
    throw new Error("ATLAS_EMAIL_RESEND_API_KEY is required when ATLAS_EMAIL_PROVIDER=resend.");
  }

  if (runtime.emailProvider === "capture" && !runtime.captureUrl) {
    throw new Error("ATLAS_EMAIL_CAPTURE_URL is required when ATLAS_EMAIL_PROVIDER=capture.");
  }
}

/**
 * Checks whether an email is permitted to bootstrap access through the
 * operator allowlist.
 *
 * Existing workspace members and invited operators are handled by higher-level
 * auth checks, so an empty allowlist intentionally grants no bootstrap access.
 */
export function isAllowedEmail(email: string): boolean {
  const { allowedEmails } = getAuthRuntimeConfig();
  if (allowedEmails.size === 0) {
    return false;
  }

  return allowedEmails.has(email.trim().toLowerCase());
}
