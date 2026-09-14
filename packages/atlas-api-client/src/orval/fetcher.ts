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

/**
 * The sentence a visitor reads for each class of failed Atlas API response.
 *
 * `public-loader-errors.ts` in the app recognizes an outage by the
 * `unavailable` wording after a server function strips everything but the
 * message, so change that sentence only together with that check.
 */
export const ATLAS_API_ERROR_MESSAGES = {
  invalid: "Atlas couldn't use those details. Check them and try again.",
  signIn: "Sign in to Atlas to continue.",
  forbidden: "You don't have permission to do that in Atlas.",
  notFound: "Atlas couldn't find that. It may have moved or been removed.",
  conflict: "That conflicts with a recent change. Refresh the page and try again.",
  busy: "Atlas is busy right now. Try again in a moment.",
  unavailable: "Atlas is temporarily unavailable. Please try again.",
  failed: "Atlas couldn't complete that request. Try again.",
} as const;

/** One of the sentences in `ATLAS_API_ERROR_MESSAGES`. */
export type AtlasApiErrorMessage =
  (typeof ATLAS_API_ERROR_MESSAGES)[keyof typeof ATLAS_API_ERROR_MESSAGES];

/**
 * Chooses the visitor-safe sentence for an API status.
 *
 * The response body never decides the message. A body can be a rate limiter's
 * JSON, a proxy's HTML page, or an exception name, and every screen that shows
 * `error.message` would print it.
 */
export function atlasApiErrorMessage(status: number): AtlasApiErrorMessage {
  if (status >= 500) {
    return ATLAS_API_ERROR_MESSAGES.unavailable;
  }
  switch (status) {
    case 400:
    case 422:
      return ATLAS_API_ERROR_MESSAGES.invalid;
    case 401:
      return ATLAS_API_ERROR_MESSAGES.signIn;
    case 403:
      return ATLAS_API_ERROR_MESSAGES.forbidden;
    case 404:
    case 410:
      return ATLAS_API_ERROR_MESSAGES.notFound;
    case 409:
      return ATLAS_API_ERROR_MESSAGES.conflict;
    case 408:
    case 425:
    case 429:
      return ATLAS_API_ERROR_MESSAGES.busy;
    default:
      return ATLAS_API_ERROR_MESSAGES.failed;
  }
}

/**
 * A failed Atlas API response.
 *
 * `message` is always safe to show a visitor. `body` holds the raw response
 * text for logs and for `userFacingApiDetail`, and no screen should render it.
 */
export class AtlasApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(atlasApiErrorMessage(status));
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

/** Returns the headers the app server adds to an Atlas API call it makes for a visitor. */
export type ServerRequestHeadersProvider = () => Record<string, string>;

let serverRequestHeaders: ServerRequestHeadersProvider | undefined;

/**
 * Registers how the app server identifies the visitor behind a server-side call.
 *
 * A server render calls the API from the app server's own address. Without the
 * visitor's identity, every visitor shares one anonymous rate-limit bucket at
 * the API, and once it empties every server-rendered page fails.
 */
export function setServerRequestHeadersProvider(provider: ServerRequestHeadersProvider): void {
  serverRequestHeaders = provider;
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
      ...(typeof window === "undefined" && serverRequestHeaders ? serverRequestHeaders() : {}),
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
