import { createFileRoute } from "@tanstack/react-router";

/**
 * Streamable HTTP entry point for the Atlas remote MCP server.
 *
 * The transport requires bidirectional streaming (POST chunked body, GET
 * text/event-stream), so the proxy reads the request body as a ReadableStream
 * rather than buffering it. The Authorization header is forwarded verbatim
 * — clients obtain a bearer token through the OAuth flow advertised at
 * `/.well-known/oauth-protected-resource`.
 */
export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        const { proxyAtlasMcpRequest } = await import("@/domains/access/server/mcp-proxy");
        return proxyAtlasMcpRequest(request);
      },
      GET: async ({ request }) => {
        const { proxyAtlasMcpRequest } = await import("@/domains/access/server/mcp-proxy");
        return proxyAtlasMcpRequest(request);
      },
      OPTIONS: async ({ request }) => {
        const { proxyAtlasMcpRequest } = await import("@/domains/access/server/mcp-proxy");
        return proxyAtlasMcpRequest(request);
      },
      POST: async ({ request }) => {
        const { proxyAtlasMcpRequest } = await import("@/domains/access/server/mcp-proxy");
        return proxyAtlasMcpRequest(request);
      },
    },
  },
});
