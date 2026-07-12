import "@tanstack/react-start/server-only";

import { createInternalAuthHeaders } from "@/domains/access/config";
import {
  SlidingWindowRateLimiter,
  bucketSpecsForRequest,
  buildTooManyRequestsResponse,
  logAnonymousRateLimit,
  resolveClientIp,
} from "./anonymous-rate-limit";
import { loadAtlasSession } from "./session-state";
import { type AuthRuntimeConfig, getAuthRuntimeConfig } from "./runtime";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

const REQUEST_HEADERS_TO_DROP = new Set([
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "transfer-encoding",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-atlas-client-ip",
  "x-atlas-proxy-secret",
  "x-real-ip",
]);

const RESPONSE_HEADERS_TO_DROP = new Set([
  "connection",
  "content-length",
  "set-cookie",
  "transfer-encoding",
]);

const anonymousProxyRateLimiter = new SlidingWindowRateLimiter();

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

async function buildInternalAuthHeaders(
  request: Request,
  runtime: AuthRuntimeConfig,
): Promise<Record<string, string>> {
  const { internalSecret, localMode } = runtime;
  const cookie = request.headers.get("cookie");

  if (localMode || !cookie || !internalSecret) {
    return {};
  }

  const session = await loadAtlasSession();

  if (!session) {
    return {};
  }

  return createInternalAuthHeaders(session.user, internalSecret, {
    organizationId: session.workspace.activeOrganization?.id,
  });
}

function buildAtlasApiUrl(request: Request, apiBaseUrl: string): string {
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(requestUrl.pathname, `${apiBaseUrl}/`);
  upstreamUrl.search = requestUrl.search;
  return upstreamUrl.toString();
}

export async function proxyAtlasApiRequest(request: Request): Promise<Response> {
  const runtime = getAuthRuntimeConfig();
  const { apiBaseUrl } = runtime;
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
  const internalHeaders = await buildInternalAuthHeaders(request, runtime);
  const proxyClientIp = resolveClientIp(request, runtime.anonymousRateLimit.trustedProxyHops);
  const clientKey = proxyClientIp ?? "unknown";
  if (Object.keys(internalHeaders).length === 0 && runtime.anonymousRateLimit.enabled) {
    const reservation = anonymousProxyRateLimiter.reserve(
      clientKey,
      bucketSpecsForRequest(request.method, runtime.anonymousRateLimit),
    );
    if (!reservation.allowed) {
      logAnonymousRateLimit(reservation, {
        clientKey,
        layer: "app-proxy",
        method: request.method,
        pathname: new URL(request.url).pathname,
      });
      return buildTooManyRequestsResponse(reservation);
    }
  }

  Object.entries(internalHeaders).forEach(([key, value]) => {
    upstreamHeaders.set(key, value);
  });
  if (runtime.internalSecret && proxyClientIp) {
    upstreamHeaders.set("X-Atlas-Client-IP", proxyClientIp);
    upstreamHeaders.set("X-Atlas-Proxy-Secret", runtime.internalSecret);
  }

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

  const responseBody = request.method === "HEAD" ? null : await apiResponse.arrayBuffer();

  return new Response(responseBody, {
    headers: copyProxyHeaders(apiResponse.headers, RESPONSE_HEADERS_TO_DROP),
    status: apiResponse.status,
    statusText: apiResponse.statusText,
  });
}
