import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleDeviceAuthAlias: vi.fn((request: Request, endpoint: string) =>
    Promise.resolve(new Response(`${endpoint}:${request.method}`)),
  ),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/device-auth-alias", () => ({
  handleDeviceAuthAlias: mocks.handleDeviceAuthAlias,
}));

describe("device auth alias routes", () => {
  it("serves the canonical Scout device code endpoint", async () => {
    const routeModule = await import("@/routes/device/code");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handler = Route.options.server?.handlers?.POST;
    if (!handler) throw new Error("Expected POST handler.");

    const request = new Request("https://atlas.test/device/code", { method: "POST" });
    const response = (await handler({ request })) as Response;

    expect(mocks.handleDeviceAuthAlias).toHaveBeenCalledWith(request, "code");
    expect(await response.text()).toBe("code:POST");
  });

  it("serves the canonical Scout device token endpoint", async () => {
    const routeModule = await import("@/routes/device/token");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handler = Route.options.server?.handlers?.POST;
    if (!handler) throw new Error("Expected POST handler.");

    const request = new Request("https://atlas.test/device/token", { method: "POST" });
    const response = (await handler({ request })) as Response;

    expect(mocks.handleDeviceAuthAlias).toHaveBeenCalledWith(request, "token");
    expect(await response.text()).toBe("token:POST");
  });

  it("serves browser approval status and decision aliases", async () => {
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const statusModule = await import("@/routes/device/status");
    const approveModule = await import("@/routes/device/approve");
    const denyModule = await import("@/routes/device/deny");
    const statusHandler = asRouteStub(statusModule.Route).options.server?.handlers?.GET;
    const approveHandler = asRouteStub(approveModule.Route).options.server?.handlers?.POST;
    const denyHandler = asRouteStub(denyModule.Route).options.server?.handlers?.POST;
    if (!statusHandler || !approveHandler || !denyHandler) {
      throw new Error("Expected device approval handlers.");
    }

    await statusHandler({
      request: new Request("https://atlas.test/device/status?user_code=ABCD-EFGH"),
    });
    await approveHandler({
      request: new Request("https://atlas.test/device/approve", { method: "POST" }),
    });
    await denyHandler({
      request: new Request("https://atlas.test/device/deny", { method: "POST" }),
    });

    expect(mocks.handleDeviceAuthAlias).toHaveBeenCalledWith(expect.any(Request), "status");
    expect(mocks.handleDeviceAuthAlias).toHaveBeenCalledWith(expect.any(Request), "approve");
    expect(mocks.handleDeviceAuthAlias).toHaveBeenCalledWith(expect.any(Request), "deny");
  });
});
