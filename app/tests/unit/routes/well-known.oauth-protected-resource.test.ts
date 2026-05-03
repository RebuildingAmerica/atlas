import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/oauth-as-metadata", () => ({
  buildProtectedResourceMetadata: vi.fn(() => ({
    resource: "https://atlas.test/api/mcp",
  })),
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: vi.fn(() => ({ publicBaseUrl: "https://atlas.test" })),
}));

describe("routes/.well-known/oauth-protected-resource", () => {
  it("returns the protected-resource metadata document", async () => {
    const routeModule = await import("@/routes/[.]well-known/oauth-protected-resource/index");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");
    const response = (await handlers.GET({})) as Response;
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("max-age=300");
    expect(await response.json()).toEqual({ resource: "https://atlas.test/api/mcp" });
  });
});
