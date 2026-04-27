import "@tanstack/react-start/server-only";

import { getAuthRuntimeConfig } from "./runtime";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

const REQUEST_HEADERS_TO_DROP = new Set([
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
]);

const RESPONSE_HEADERS_TO_DROP = new Set(["connection", "content-length", "transfer-encoding"]);

interface FetchInitWithDuplex extends RequestInit {
  duplex?: "half";
}

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

function buildAtlasMcpUrl(request: Request, apiBaseUrl: string): string {
  const requestUrl = new URL(request.url);
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, `${apiBaseUrl}/`).toString();
}

/**
 * Streams a /mcp request through to the Atlas API without buffering the body.
 *
 * The MCP Streamable HTTP transport uses request and response streams (POST
 * with chunked body, GET with text/event-stream), so reading the request via
 * `arrayBuffer()` would break it. The Authorization header is forwarded
 * verbatim; internal session headers are intentionally NOT injected because
 * MCP traffic authenticates via OAuth bearer tokens issued through the
 * publisher discovery flow, not browser sessions.
 */
export async function proxyAtlasMcpRequest(request: Request): Promise<Response> {
  const { apiBaseUrl } = getAuthRuntimeConfig();
  if (!apiBaseUrl) {
    return Response.json(
      {
        error:
          "Atlas API proxy target is not configured. Set ATLAS_SERVER_API_PROXY_TARGET on the app server or configure public /mcp routing to the Atlas API.",
      },
      { headers: NO_STORE_HEADERS, status: 502 },
    );
  }

  const upstreamHeaders = copyProxyHeaders(request.headers, REQUEST_HEADERS_TO_DROP);

  const init: FetchInitWithDuplex = {
    headers: upstreamHeaders,
    method: request.method,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  let apiResponse: Response;
  try {
    apiResponse = await fetch(buildAtlasMcpUrl(request, apiBaseUrl), init);
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
