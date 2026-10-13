import type { AtlasEdgeEnv } from "./worker-configuration";

/** Keep SSR, sign-in and server functions on one pinned application revision. */
export default {
  async fetch(request: Request, env: AtlasEdgeEnv): Promise<Response> {
    let origin: URL;
    try {
      origin = new URL(env.ATLAS_WEB_ORIGIN_URL);
      if (
        origin.protocol !== "https:" ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash ||
        origin.username ||
        origin.password ||
        !env.ATLAS_WEB_ORIGIN_SECRET
      ) {
        throw new Error("Invalid origin");
      }
    } catch {
      return new Response("Service unavailable.", {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }
    const publicUrl = new URL(request.url);
    const target = new URL(origin);
    target.pathname = publicUrl.pathname;
    target.search = publicUrl.search;
    const headers = new Headers(request.headers);
    for (const key of [...headers.keys()]) {
      if (
        /^(?:cf-|x-forwarded-)/i.test(key) ||
        [
          "host",
          "forwarded",
          "connection",
          "upgrade",
          "x-real-ip",
          "x-atlas-client-ip",
          "x-atlas-proxy-secret",
          "x-atlas-web-origin-secret",
          "x-atlas-web-client-ip",
        ].includes(key.toLowerCase())
      )
        headers.delete(key);
    }
    headers.set("x-atlas-web-origin-secret", env.ATLAS_WEB_ORIGIN_SECRET);
    headers.set("x-forwarded-host", publicUrl.host);
    headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp) {
      headers.set("x-forwarded-for", clientIp);
      headers.set("x-atlas-web-client-ip", clientIp);
    }
    try {
      const upstream = await fetch(
        new Request(
          target,
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
      console.error(JSON.stringify({ event: "atlas_web_origin_failure" }));
      return new Response("Service unavailable.", {
        status: 502,
        headers: { "cache-control": "no-store" },
      });
    }
  },
};
