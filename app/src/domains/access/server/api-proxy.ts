import "@tanstack/react-start/server-only";

import { createInternalAuthHeaders } from "@/domains/access/config";
import { loadAtlasSession } from "./session-state";
import { getAuthRuntimeConfig } from "./runtime";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

const REQUEST_HEADERS_TO_DROP = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "transfer-encoding",
]);

const RESPONSE_HEADERS_TO_DROP = new Set([
  "connection",
  "content-length",
  "set-cookie",
  "transfer-encoding",
]);

function copyProxyHeaders(headers: Headers, blockedHeaders: Set<string>): Headers {
  const proxyHeaders = new Headers();

  headers.forEach((value, key) => {
    if (blockedHeaders.has(key.toLowerCase())) {
      return;
    }

    proxyHeaders.set(key, value);
  });

  return proxyHeaders;
}

async function buildInternalAuthHeaders(request: Request): Promise<Record<string, string>> {
  const { internalSecret } = getAuthRuntimeConfig();
  const cookie = request.headers.get("cookie");

  if (!cookie || !internalSecret) {
    return {};
  }

  const session = await loadAtlasSession();

  if (!session || session.isLocal) {
    return {};
  }

  return createInternalAuthHeaders(session.user, internalSecret, {
    organizationId: session.workspace.activeOrganization?.id,
  });
}

function buildAtlasApiUrl(request: Request, apiBaseUrl: string): string {
  const requestUrl = new URL(request.url);
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, `${apiBaseUrl}/`).toString();
}

export async function proxyAtlasApiRequest(request: Request): Promise<Response> {
  const { apiBaseUrl } = getAuthRuntimeConfig();
  if (!apiBaseUrl) {
    return Response.json(
      {
        error:
          "Atlas API proxy target is not configured. Set ATLAS_SERVER_API_PROXY_TARGET on the app server or configure public /api routing to the Atlas API.",
      },
      { headers: NO_STORE_HEADERS, status: 502 },
    );
  }

  const upstreamHeaders = copyProxyHeaders(request.headers, REQUEST_HEADERS_TO_DROP);
  const internalHeaders = await buildInternalAuthHeaders(request);
  Object.entries(internalHeaders).forEach(([key, value]) => {
    upstreamHeaders.set(key, value);
  });

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  let apiResponse: Response;
  try {
    apiResponse = await fetch(buildAtlasApiUrl(request, apiBaseUrl), {
      body,
      headers: upstreamHeaders,
      method: request.method,
      redirect: "manual",
    });
  } catch {
    return Response.json(
      { error: "Atlas API is unavailable." },
      { headers: NO_STORE_HEADERS, status: 503 },
    );
  }

  return new Response(apiResponse.body, {
    headers: copyProxyHeaders(apiResponse.headers, RESPONSE_HEADERS_TO_DROP),
    status: apiResponse.status,
    statusText: apiResponse.statusText,
  });
}
