import type { ServerApiTransport } from "@rebuildingamerica/atlas-api-client/orval/fetcher";

export interface ApiRuntimeBinding {
  getByName(
    name: string,
    options: { locationHint: "enam" },
  ): { fetch(request: Request): Promise<Response> };
}

/** Keep the API's request stream and visitor rate-limit identity inside the current request. */
export function createWorkerApiTransport(
  binding: ApiRuntimeBinding,
  apiOrigin: string,
  clientIp: string | null,
  internalSecret: string,
  routePrefix: "" | "/atlas",
): ServerApiTransport {
  if (routePrefix !== "" && routePrefix !== "/atlas")
    throw new Error("API binding route prefix must be explicit");
  const origin = new URL(apiOrigin).origin;
  return async (request) => {
    const target = new URL(request.url);
    if (
      target.origin !== origin ||
      !(
        /^(?:\/api(?:\/|$)|\/mcp(?:\/|$))/.test(target.pathname) ||
        ["/health", "/openapi.json"].includes(target.pathname)
      ) ||
      /^\/api\/(?:auth|stripe|e2e)(?:\/|$)/.test(target.pathname) ||
      (/^\/api\/atproto(?:\/|$)/.test(target.pathname) &&
        !/^\/api\/atproto\/identities(?:\/|$)/.test(target.pathname))
    )
      return undefined;
    const headers = new Headers(request.headers);
    const hopHeaders =
      headers
        .get("connection")
        ?.split(",")
        .map((name) => name.trim()) ?? [];
    for (const name of [...headers.keys()]) {
      if (
        /^(?:x-forwarded-|x-vercel-|cf-access-)/i.test(name) ||
        [
          "cookie",
          "host",
          "connection",
          "content-length",
          "keep-alive",
          "transfer-encoding",
          "upgrade",
          "proxy-authorization",
          "proxy-authenticate",
          "te",
          "trailer",
          "forwarded",
          "x-real-ip",
          "cf-connecting-ip",
          "x-atlas-client-ip",
          "x-atlas-proxy-secret",
        ].includes(name)
      )
        headers.delete(name);
    }
    for (const name of hopHeaders) if (name) headers.delete(name);
    if (clientIp && internalSecret) {
      headers.set("x-atlas-client-ip", clientIp);
      headers.set("x-atlas-proxy-secret", internalSecret);
    }
    target.pathname = routePrefix + target.pathname;
    return binding
      .getByName("application", { locationHint: "enam" })
      .fetch(new Request(target, new Request(request, { headers, redirect: "manual" })));
  };
}
