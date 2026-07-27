import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/internal-api-key", () => ({
  introspectApiKeyRequest: vi.fn((request: Request) =>
    Promise.resolve(new Response(`introspected:${request.method}`)),
  ),
}));

describe("routes/api/auth/internal/api-key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("delegates POST to introspectApiKeyRequest", async () => {
    const { introspectApiKeyRequest } = await import("@/domains/access/server/internal-api-key");
    const routeModule = await import("@/routes/api/auth/internal/api-key");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");
    const request = new Request("https://atlas.test/api/auth/internal/api-key", {
      method: "POST",
    });
    const response = (await handlers.POST({ request })) as Response;
    expect(introspectApiKeyRequest).toHaveBeenCalledWith(request);
    expect(await response.text()).toBe("introspected:POST");
  });

  it("refuses to introspect an API key outside the server bundle", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/auth/internal/api-key");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const handlers = asRouteStub(routeModule.Route).options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");
    const request = new Request("https://atlas.test/api/auth/internal/api-key", {
      method: "POST",
    });

    await expect(handlers.POST({ request })).rejects.toThrow(
      "Internal API-key introspection is only available on the server.",
    );
  });
});
