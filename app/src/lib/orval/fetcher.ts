import { getServerApiBaseUrl } from "@/platform/config/app-config";

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
