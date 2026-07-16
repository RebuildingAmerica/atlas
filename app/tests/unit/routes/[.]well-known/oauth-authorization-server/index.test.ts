import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@rebuildingamerica/atlas-access/oauth-as-metadata", () => ({
  buildAuthorizationServerMetadata: vi.fn(() => ({
    issuer: "https://atlas.test/api/auth",
  })),
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: vi.fn(() => ({ publicBaseUrl: "https://atlas.test" })),
}));

describe("routes/.well-known/oauth-authorization-server (root)", () => {
  it("returns the AS metadata as JSON with cache headers", async () => {
    const routeModule = await import("@/routes/[.]well-known/oauth-authorization-server/index");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");
    const response = (await handlers.GET({})) as Response;
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("max-age=300");
    expect(await response.json()).toEqual({ issuer: "https://atlas.test/api/auth" });
  });
});
