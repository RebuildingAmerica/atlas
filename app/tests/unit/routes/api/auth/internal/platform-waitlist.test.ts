import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/waitlist/server/internal-platform-waitlist", () => ({
  handlePlatformWaitlistRequest: vi.fn(() => Promise.resolve(Response.json({ account: null }))),
}));

describe("routes/api/auth/internal/platform-waitlist", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hands the API's lookup to the platform lookup handler", async () => {
    const { handlePlatformWaitlistRequest } =
      await import("@/domains/waitlist/server/internal-platform-waitlist");
    const routeModule = await import("@/routes/api/auth/internal/platform-waitlist");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const handlers = asRouteStub(routeModule.Route).options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");

    const request = new Request("https://atlas.test/api/auth/internal/platform-waitlist", {
      method: "POST",
    });
    const response = (await handlers.POST({ request, params: {} })) as Response;

    expect(handlePlatformWaitlistRequest).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
  });

  it("refuses to run outside the server bundle", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/auth/internal/platform-waitlist");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const handlers = asRouteStub(routeModule.Route).options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");

    await expect(
      handlers.POST({
        request: new Request("https://atlas.test/api/auth/internal/platform-waitlist", {
          method: "POST",
        }),
        params: {},
      }),
    ).rejects.toThrow("only answered on the server");
  });
});
