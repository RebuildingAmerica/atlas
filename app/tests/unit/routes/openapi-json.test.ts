import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: vi.fn(),
}));

describe("routes/openapi.json", () => {
  beforeEach(async () => {
    const config = await import("@/domains/access/server/runtime");
    vi.mocked(config.getAuthRuntimeConfig).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 502 when no API base URL is configured", async () => {
    const config = await import("@/domains/access/server/runtime");
    vi.mocked(config.getAuthRuntimeConfig).mockReturnValue({
      apiBaseUrl: null,
    } as ReturnType<typeof config.getAuthRuntimeConfig>);

    const routeModule = await import("@/routes/openapi[.]json");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");
    const response = (await handlers.GET({})) as Response;
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("Atlas API proxy target is not configured");
  });

  it("proxies a 200 response from the API service", async () => {
    const config = await import("@/domains/access/server/runtime");
    vi.mocked(config.getAuthRuntimeConfig).mockReturnValue({
      apiBaseUrl: "https://api.atlas.test",
    } as ReturnType<typeof config.getAuthRuntimeConfig>);
    const apiResponse = new Response('{"openapi":"3.0.0"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiResponse);

    const routeModule = await import("@/routes/openapi[.]json");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");
    const response = (await handlers.GET({})) as Response;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ openapi: "3.0.0" });
  });

  it("returns 503 when the API request rejects", async () => {
    const config = await import("@/domains/access/server/runtime");
    vi.mocked(config.getAuthRuntimeConfig).mockReturnValue({
      apiBaseUrl: "https://api.atlas.test",
    } as ReturnType<typeof config.getAuthRuntimeConfig>);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const routeModule = await import("@/routes/openapi[.]json");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");
    const response = (await handlers.GET({})) as Response;
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("OpenAPI document is unavailable");
  });
});
