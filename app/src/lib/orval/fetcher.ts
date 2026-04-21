import { getServerApiBaseUrl } from "@/platform/config/app-config";

function getRuntimeAppOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return getServerApiBaseUrl({
    ATLAS_PUBLIC_URL: process.env.ATLAS_PUBLIC_URL,
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
    const message = await response.text();
    throw new Error(message || `Atlas API request failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
