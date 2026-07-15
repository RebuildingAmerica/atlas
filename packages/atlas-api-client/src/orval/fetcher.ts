const API_PATH_SUFFIX = "/api";

interface ApiClientEnv {
  ATLAS_PUBLIC_URL?: string;
  ATLAS_SERVER_API_PROXY_TARGET?: string;
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

function getConfiguredPublicUrl(env: ApiClientEnv): string | undefined {
  const publicUrl = env.ATLAS_PUBLIC_URL?.trim();
  if (!publicUrl) {
    return undefined;
  }

  if (!isAbsoluteUrl(publicUrl)) {
    throw new Error("ATLAS_PUBLIC_URL must be an absolute URL.");
  }

  return trimTrailingSlash(publicUrl);
}

function getServerApiBaseUrl(env: ApiClientEnv): string {
  const serverProxyTarget = env.ATLAS_SERVER_API_PROXY_TARGET?.trim();
  if (serverProxyTarget) {
    if (!isAbsoluteUrl(serverProxyTarget)) {
      throw new Error("ATLAS_SERVER_API_PROXY_TARGET must be an absolute URL.");
    }

    return ensureApiSuffix(serverProxyTarget);
  }

  const publicUrl = getConfiguredPublicUrl(env);
  if (publicUrl) {
    return ensureApiSuffix(publicUrl);
  }

  throw new Error(
    "ATLAS_PUBLIC_URL or ATLAS_SERVER_API_PROXY_TARGET is required for server-side Atlas API calls.",
  );
}

function buildAtlasApiErrorMessage(status: number, message: string): string {
  if (status >= 500) {
    return "Atlas is temporarily unavailable. Please try again.";
  }

  return message || `Atlas API request failed (${status})`;
}

export class AtlasApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(buildAtlasApiErrorMessage(status, body));
    this.name = "AtlasApiError";
    this.status = status;
    this.body = body;
  }
}

function getRuntimeAppOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return getServerApiBaseUrl({
    ATLAS_PUBLIC_URL: process.env.ATLAS_PUBLIC_URL,
    ATLAS_SERVER_API_PROXY_TARGET: process.env.ATLAS_SERVER_API_PROXY_TARGET,
  }).replace(/\/api$/, "");
}

export async function atlasFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const requestUrl = /^https?:\/\//.test(url)
    ? url
    : new URL(url, `${getRuntimeAppOrigin()}/`).toString();
  const response = await fetch(requestUrl, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new AtlasApiError(response.status, await response.text());
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
