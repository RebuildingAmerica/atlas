import { fetchAtlasApiResponse } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import type { AtlasWorkerEnv } from "../worker-configuration";
const DOCS_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/** These are the existing Nitro proxy routes, not a blanket /api rewrite. */
export async function proxyHostedRequest(
  request: Request,
  env: Pick<
    AtlasWorkerEnv,
    "ATLAS_DOCS_URL" | "ATLAS_SERVER_API_PROXY_TARGET" | "ATLAS_EDGE_ORIGIN_SECRET"
  >,
): Promise<Response | null> {
  const url = new URL(request.url);
  const docs = url.pathname === "/docs" || url.pathname.startsWith("/docs/");
  const api =
    url.pathname === "/mcp" ||
    url.pathname.startsWith("/mcp/") ||
    url.pathname === "/api/entities" ||
    url.pathname.startsWith("/api/entities/");
  if (!docs && !api) return null;
  const origin = docs ? env.ATLAS_DOCS_URL : env.ATLAS_SERVER_API_PROXY_TARGET;
  if (!origin)
    return new Response("Service unavailable.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  const target = new URL(origin);
  target.pathname = url.pathname === "/mcp" ? "/mcp/" : url.pathname;
  target.search = url.search;
  const headers = new Headers(request.headers);
  for (const key of [
    "cookie",
    "x-atlas-internal-secret",
    "x-atlas-actor-assertion",
    "x-atlas-actor-id",
    "x-atlas-actor-email",
    "x-atlas-organization-id",
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "proxy-authorization",
    "te",
    "trailer",
  ])
    headers.delete(key);
  if (docs) headers.delete("authorization");
  const clientIp = headers.get("x-forwarded-for");
  if (api && clientIp) {
    headers.set("x-atlas-client-ip", clientIp);
    headers.set("x-atlas-proxy-secret", env.ATLAS_EDGE_ORIGIN_SECRET);
  }
  const upstream = await (docs ? fetch : fetchAtlasApiResponse)(
    new Request(target, new Request(request, { headers, redirect: "manual" })),
  );
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("cache-control", "private, no-store");
  if (docs) responseHeaders.set("content-security-policy", DOCS_CSP);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
