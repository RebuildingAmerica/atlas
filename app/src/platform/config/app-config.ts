const API_PATH_SUFFIX = "/api";
const DEFAULT_AUTH_BASE_PATH = "/api/auth";

interface AppConfigEnv {
  ATLAS_AUTH_BASE_PATH?: string;
  ATLAS_DEPLOY_MODE?: string;
  ATLAS_PUBLIC_URL?: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

function ensureApiSuffix(value: string): string {
  const normalizedValue = trimTrailingSlash(value);
  if (normalizedValue.endsWith(API_PATH_SUFFIX)) {
    return normalizedValue;
  }

  return `${normalizedValue}${API_PATH_SUFFIX}`;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function getConfiguredPublicUrl(env: AppConfigEnv): string | undefined {
  const publicUrl = env.ATLAS_PUBLIC_URL?.trim();
  if (!publicUrl) {
    return undefined;
  }

  if (!isAbsoluteUrl(publicUrl)) {
    throw new Error("ATLAS_PUBLIC_URL must be an absolute URL.");
  }

  return trimTrailingSlash(publicUrl);
}

export function getApiBaseUrl(env: AppConfigEnv = import.meta.env): string {
  const publicUrl = getConfiguredPublicUrl(env);
  if (!publicUrl) {
    throw new Error("ATLAS_PUBLIC_URL is required for configured Atlas API calls.");
  }

  return ensureApiSuffix(publicUrl);
}

export function getAppConfig(env: AppConfigEnv = import.meta.env) {
  const authBasePath = env.ATLAS_AUTH_BASE_PATH?.trim() || DEFAULT_AUTH_BASE_PATH;
  const publicUrl = getConfiguredPublicUrl(env);

  let authBaseUrl: string | undefined;
  if (isAbsoluteUrl(authBasePath)) {
    authBaseUrl = authBasePath;
  } else {
    if (authBasePath !== DEFAULT_AUTH_BASE_PATH && publicUrl) {
      authBaseUrl = joinUrl(publicUrl, authBasePath);
    }
  }

  return {
    ...(publicUrl ? { apiBaseUrl: ensureApiSuffix(publicUrl) } : {}),
    authBasePath,
    ...(authBaseUrl ? { authBaseUrl } : {}),
    localMode: env.ATLAS_DEPLOY_MODE === "local",
  };
}

export function getAbsoluteApiBaseUrl({
  env = import.meta.env,
  origin,
}: {
  env?: AppConfigEnv;
  origin?: string;
} = {}): string {
  const publicUrl = getConfiguredPublicUrl(env);
  if (publicUrl) {
    return ensureApiSuffix(publicUrl);
  }

  const publicOrigin = origin?.trim() ? trimTrailingSlash(origin) : undefined;
  if (!publicOrigin) {
    throw new Error(
      "ATLAS_PUBLIC_URL is required when the current browser origin is unavailable for browser-visible API calls.",
    );
  }

  return new URL(API_PATH_SUFFIX, `${publicOrigin}/`).toString();
}

export function getServerApiBaseUrl(env: AppConfigEnv = process.env): string {
  const publicUrl = getConfiguredPublicUrl(env);
  if (publicUrl) {
    return ensureApiSuffix(publicUrl);
  }

  throw new Error("ATLAS_PUBLIC_URL is required for server-side Atlas API calls.");
}
