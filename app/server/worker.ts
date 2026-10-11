import "reflect-metadata";
import type { AtlasWorkerEnv } from "../worker-configuration";
import type { Hyperdrive } from "@cloudflare/workers-types";
import handler from "@tanstack/react-start/server-entry";
import { runWorkerRequest } from "./request-scope";
import { proxyHostedRequest } from "./hosted-proxy";
import { anonymousSessionResponse } from "../src/domains/access/server/anonymous-session";
import { dispatchAuthRequest } from "../src/domains/access/server/auth-request-handler";

// Scope the native binding type to this entrypoint; global Workers declarations
// would replace DOM types in the browser application and its tests.
interface WorkerRuntimeEnv extends Omit<AtlasWorkerEnv, "HYPERDRIVE"> {
  HYPERDRIVE: Hyperdrive;
}

// Evaluate immutable modules during isolate startup, after the reflection
// polyfill. Routers, query caches, sessions, and clients remain request-scoped
// so first-page latency improves without sharing anyone's identity or content.
await Promise.all([
  import("../src/router"),
  import("../src/start"),
  import("../src/domains/access/server/api-request-identity"),
]);

export default {
  async fetch(request: Request, env: WorkerRuntimeEnv): Promise<Response> {
    const anonymous = anonymousSessionResponse(request);
    if (anonymous) return anonymous;
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
        (await proxyHostedRequest(forwarded, env)) ??
        // Session checks are HTTP auth requests and need no page router. The
        // shared dispatcher retains the same guards and request-scoped identity.
        (request.method === "GET" && url.pathname === "/api/auth/get-session"
          ? await dispatchAuthRequest(forwarded)
          : await handler.fetch(forwarded));
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
