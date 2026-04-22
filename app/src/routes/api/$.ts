import { createFileRoute } from "@tanstack/react-router";

/**
 * Generic Atlas API proxy for browser-visible `/api/*` requests that are not
 * handled directly by the app server (for example Better Auth or webhooks).
 */
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
        return proxyAtlasApiRequest(request);
      },
      GET: async ({ request }) => {
        const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
        return proxyAtlasApiRequest(request);
      },
      HEAD: async ({ request }) => {
        const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
        return proxyAtlasApiRequest(request);
      },
      OPTIONS: async ({ request }) => {
        const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
        return proxyAtlasApiRequest(request);
      },
      PATCH: async ({ request }) => {
        const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
        return proxyAtlasApiRequest(request);
      },
      POST: async ({ request }) => {
        const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
        return proxyAtlasApiRequest(request);
      },
      PUT: async ({ request }) => {
        const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
        return proxyAtlasApiRequest(request);
      },
    },
  },
});
