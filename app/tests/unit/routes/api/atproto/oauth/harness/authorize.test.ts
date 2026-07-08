import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAtprotoHarnessProviderCallbackUrl: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/atproto-oauth", () => ({
  createAtprotoHarnessProviderCallbackUrl: mocks.createAtprotoHarnessProviderCallbackUrl,
}));

describe("routes/api/atproto/oauth/harness/authorize", () => {
  beforeEach(() => {
    mocks.createAtprotoHarnessProviderCallbackUrl.mockReset();
  });

  it("redirects the internal provider authorization to the ATProto callback", async () => {
    mocks.createAtprotoHarnessProviderCallbackUrl.mockReturnValue(
      new URL(
        "https://atlas.test/api/atproto/oauth/callback?code=atlas-e2e-harness&state=state_1&handle=org.example",
      ),
    );
    const routeModule = await import("@/routes/api/atproto/oauth/harness/authorize");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({
      request: new Request(
        "https://atlas.test/api/atproto/oauth/harness/authorize?state=state_1&handle=org.example",
      ),
    })) as Response;

    const params = mocks.createAtprotoHarnessProviderCallbackUrl.mock
      .calls[0]?.[0] as URLSearchParams;
    expect(params.get("state")).toBe("state_1");
    expect(params.get("handle")).toBe("org.example");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://atlas.test/api/atproto/oauth/callback?code=atlas-e2e-harness&state=state_1&handle=org.example",
    );
  });
});
