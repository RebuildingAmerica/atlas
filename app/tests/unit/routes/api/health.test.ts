import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: vi.fn(),
}));

describe("routes/api/health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok when no API base URL is configured", async () => {
    const { getAuthRuntimeConfig } = await import("@/domains/access/server/runtime");
    vi.mocked(getAuthRuntimeConfig).mockReturnValue({
      apiBaseUrl: null,
    } as ReturnType<typeof getAuthRuntimeConfig>);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const routeModule = await import("@/routes/api/health");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({})) as Response;

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns ok when the API responds 2xx", async () => {
    const { getAuthRuntimeConfig } = await import("@/domains/access/server/runtime");
    vi.mocked(getAuthRuntimeConfig).mockReturnValue({
      apiBaseUrl: "https://api.atlas.test",
    } as ReturnType<typeof getAuthRuntimeConfig>);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const routeModule = await import("@/routes/api/health");
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

  it("returns degraded with 503 when the API responds non-2xx", async () => {
    const { getAuthRuntimeConfig } = await import("@/domains/access/server/runtime");
    vi.mocked(getAuthRuntimeConfig).mockReturnValue({
      apiBaseUrl: "https://api.atlas.test",
    } as ReturnType<typeof getAuthRuntimeConfig>);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 502 }));

    const routeModule = await import("@/routes/api/health");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({})) as Response;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "degraded" });
  });

  it("returns degraded with 503 when the API request rejects", async () => {
    const { getAuthRuntimeConfig } = await import("@/domains/access/server/runtime");
    vi.mocked(getAuthRuntimeConfig).mockReturnValue({
      apiBaseUrl: "https://api.atlas.test",
    } as ReturnType<typeof getAuthRuntimeConfig>);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const routeModule = await import("@/routes/api/health");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({})) as Response;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "degraded" });
  });

  it("refuses to serve the document outside the server", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/health");
    const { callRouteGet } = await import("@/../tests/helpers/routes-server-handler");

    await expect(callRouteGet(routeModule.Route)).rejects.toThrow(
      "Auth runtime is only available on the server.",
    );
  });
});
