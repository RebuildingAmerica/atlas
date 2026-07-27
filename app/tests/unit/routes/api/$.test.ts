import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/api-proxy", () => ({
  proxyAtlasApiRequest: vi.fn((request: Request) =>
    Promise.resolve(new Response(`proxied:${request.method}`)),
  ),
}));

describe("routes/api/$ catch-all proxy", () => {
  it("forwards every HTTP method to proxyAtlasApiRequest", async () => {
    const routeModule = await import("@/routes/api/$");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const { proxyAtlasApiRequest } = await import("@/domains/access/server/api-proxy");
    const Route = asRouteStub(routeModule.Route);

    const handlers = Route.options.server?.handlers;
    if (!handlers) throw new Error("Expected handlers");

    const methods = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"] as const;
    for (const method of methods) {
      const request = new Request("https://atlas.test/api/foo", { method });
      const handler = handlers[method];
      expect(handler).toBeTypeOf("function");
      if (!handler) throw new Error(`Expected handler for ${method}`);
      const response = (await handler({ request })) as Response;
      expect(await response.text()).toBe(`proxied:${method}`);
    }
    expect(proxyAtlasApiRequest).toHaveBeenCalledTimes(methods.length);
  });

  it("refuses to proxy outside the server", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/$");
    const { callRouteGet } = await import("@/../tests/helpers/routes-server-handler");

    await expect(
      callRouteGet(routeModule.Route, new Request("https://atlas.test/api/foo")),
    ).rejects.toThrow("Atlas API proxying is only available on the server.");
  });
});
