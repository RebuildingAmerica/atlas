import { createFileRoute } from "@tanstack/react-router";

async function proxyAtlasApiRequest(request: Request) {
  if (import.meta.env.SSR) {
    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    return proxyAtlasApiRequest(request);
  }

  throw new Error("Atlas API proxying is only available on the server.");
}

/**
 * Generic Atlas API proxy for browser-visible `/api/*` requests that are not
 * handled directly by the app server (for example Better Auth or webhooks).
 */
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        return proxyAtlasApiRequest(request);
      },
      GET: async ({ request }) => {
        return proxyAtlasApiRequest(request);
      },
      HEAD: async ({ request }) => {
        return proxyAtlasApiRequest(request);
      },
      OPTIONS: async ({ request }) => {
        return proxyAtlasApiRequest(request);
      },
      PATCH: async ({ request }) => {
        return proxyAtlasApiRequest(request);
      },
      POST: async ({ request }) => {
        return proxyAtlasApiRequest(request);
      },
      PUT: async ({ request }) => {
        return proxyAtlasApiRequest(request);
      },
    },
  },
});
