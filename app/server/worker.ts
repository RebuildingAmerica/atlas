import "reflect-metadata";
import type { AtlasWorkerEnv } from "../worker-configuration";
import handler from "@tanstack/react-start/server-entry";
import { runWorkerRequest } from "./request-scope";
import { proxyHostedRequest } from "./hosted-proxy";

export default {
  async fetch(request: Request, env: AtlasWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    for (const key of [...headers.keys()]) {
      if (
        /^(?:x-forwarded-|x-vercel-)/i.test(key) ||
        [
          "forwarded",
          "x-real-ip",
          "x-atlas-client-ip",
          "x-atlas-proxy-secret",
          "cf-access-client-id",
          "cf-access-client-secret",
          "cf-access-jwt-assertion",
        ].includes(key.toLowerCase())
      )
        headers.delete(key);
    }
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp) headers.set("x-forwarded-for", clientIp);
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", "https");
    return runWorkerRequest(env.HYPERDRIVE.connectionString, async () => {
      const forwarded = new Request(request, { headers });
      const response =
        (await proxyHostedRequest(forwarded, env)) ?? (await handler.fetch(forwarded));
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("cache-control", "private, no-store");
      responseHeaders.delete("cdn-cache-control");
      responseHeaders.delete("cloudflare-cdn-cache-control");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    });
  },
};
