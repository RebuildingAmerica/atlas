const controls = new Set(["/health", "/__atlas/release", "/__atlas/consumers"]);
const hopHeaders = new Set([
  "host",
  "cookie",
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
]);
const hostname = (value) =>
  typeof value === "string" && /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value);
const privatePath = (path) =>
  /^(?:\/__atlas|\/api\/platform|\/public-api)(?:\/|$)/.test(path);
const denied = (status) =>
  new Response(null, {
    status,
    headers: { "cache-control": "private, no-store" },
  });

/** Preserve API clients and MCP streams without exposing binding-only operator controls. */
export default {
  async fetch(request, env) {
    if (
      !hostname(env.ATLAS_API_PUBLIC_HOSTNAME) ||
      !hostname(env.ATLAS_API_OPERATIONS_HOSTNAME) ||
      env.ATLAS_API_PUBLIC_HOSTNAME === env.ATLAS_API_OPERATIONS_HOSTNAME ||
      !env.ATLAS_EDGE_ORIGIN_SECRET?.trim()
    )
      return denied(503);
    const url = new URL(request.url);
    if (
      url.protocol !== "https:" ||
      ![
        env.ATLAS_API_PUBLIC_HOSTNAME,
        env.ATLAS_API_OPERATIONS_HOSTNAME,
      ].includes(url.hostname)
    )
      return denied(421);
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return denied(400);
    }
    if (/[\\%\x00-\x20]/.test(path)) return denied(400);
    let role = "api";
    if (url.hostname === env.ATLAS_API_OPERATIONS_HOSTNAME) {
      // Access gates this hostname before invocation. Its existing controls are
      // GET-only; /public-api exercises API authorization before domain cutover.
      if (path.startsWith("/public-api/")) {
        path = path.slice("/public-api".length);
        if (privatePath(path)) return denied(404);
        url.hostname = env.ATLAS_API_PUBLIC_HOSTNAME;
        url.pathname = path;
      } else {
        if (request.method !== "GET") return denied(405);
        const match = /^\/(api|discovery)(\/.*)$/.exec(path);
        if (!match) return denied(404);
        role = match[1];
        path = match[2];
        if (
          (role === "discovery" || path.startsWith("/__atlas")) &&
          !controls.has(path)
        )
          return denied(404);
        if (/^\/api\/platform(?:\/|$)/.test(path)) return denied(404);
        url.pathname = path;
      }
    } else if (privatePath(path)) return denied(404);

    const clientIp = request.headers.get("cf-connecting-ip");
    if (!clientIp || clientIp.length > 64 || !/^[a-fA-F0-9:.]+$/.test(clientIp))
      return denied(503);
    const headers = new Headers(request.headers);
    const connectionHeaders =
      headers
        .get("connection")
        ?.split(",")
        .map((value) => value.trim().toLowerCase()) ?? [];
    for (const key of [...headers.keys()])
      if (
        /^(?:x-atlas-|x-forwarded-|x-vercel-|cf-)/i.test(key) ||
        hopHeaders.has(key) ||
        connectionHeaders.includes(key)
      )
        headers.delete(key);
    // This existing low-privilege value grants only a visitor rate-limit bucket,
    // never actor, platform, or consumer authority.
    headers.set("x-atlas-client-ip", clientIp);
    headers.set("x-atlas-proxy-secret", env.ATLAS_EDGE_ORIGIN_SECRET);
    try {
      const binding = role === "api" ? env.API_RUNTIME : env.DISCOVERY_RUNTIME;
      const upstream = await binding
        .getByName("application", { locationHint: "enam" })
        .fetch(
          new Request(
            url,
            new Request(request, { headers, redirect: "manual" }),
          ),
        );
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set("cache-control", "private, no-store");
      responseHeaders.delete("cdn-cache-control");
      responseHeaders.delete("cloudflare-cdn-cache-control");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch {
      return denied(503);
    }
  },
};
