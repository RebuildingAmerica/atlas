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

describe("routes/.well-known/oauth-authorization-server/api/auth (issuer suffix)", () => {
  it("returns the same AS metadata document as the root variant", async () => {
    const routeModule = await import("@/routes/[.]well-known/oauth-authorization-server/api/auth");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");
    const response = (await handlers.GET({})) as Response;
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ issuer: "https://atlas.test/api/auth" });
  });

  it("refuses to serve the document outside the server", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/[.]well-known/oauth-authorization-server/api/auth");
    const { callRouteGet } = await import("@/../tests/helpers/routes-server-handler");

    await expect(callRouteGet(routeModule.Route)).rejects.toThrow(
      "Auth runtime is only available on the server.",
    );
  });
});
