import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/billing/server/internal-platform-lookup", () => ({
  handlePlatformLookupRequest: vi.fn(() => Promise.resolve(Response.json({ account: null }))),
}));

describe("routes/api/auth/internal/platform-lookup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hands the API's lookup to the platform lookup handler", async () => {
    const { handlePlatformLookupRequest } =
      await import("@/domains/billing/server/internal-platform-lookup");
    const routeModule = await import("@/routes/api/auth/internal/platform-lookup");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const handlers = asRouteStub(routeModule.Route).options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");

    const request = new Request("https://atlas.test/api/auth/internal/platform-lookup", {
      method: "POST",
    });
    const response = (await handlers.POST({ request, params: {} })) as Response;

    expect(handlePlatformLookupRequest).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
  });

  it("refuses to run outside the server bundle", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/auth/internal/platform-lookup");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const handlers = asRouteStub(routeModule.Route).options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");

    await expect(
      handlers.POST({
        request: new Request("https://atlas.test/api/auth/internal/platform-lookup", {
          method: "POST",
        }),
        params: {},
      }),
    ).rejects.toThrow("only answered on the server");
  });
});
