import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: vi.fn(),
}));

describe("routes/health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proxies the public health check to the configured API service", async () => {
    const { getAuthRuntimeConfig } = await import("@/domains/access/server/runtime");
    vi.mocked(getAuthRuntimeConfig).mockReturnValue({
      apiBaseUrl: "https://api.atlas.test",
    } as ReturnType<typeof getAuthRuntimeConfig>);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const routeModule = await import("@/routes/health");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({})) as Response;

    const fetchCall = fetchSpy.mock.calls[0];
    if (!fetchCall) throw new Error("Expected API health fetch call.");
    const [fetchUrl, fetchInit] = fetchCall;
    expect(fetchUrl).toEqual(new URL("/health", "https://api.atlas.test"));
    expect(fetchInit?.signal).toBeInstanceOf(AbortSignal);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
