import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAtprotoAuthorizationUrl: vi.fn(),
  pruneAtprotoOAuthStores: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/atproto-oauth", () => ({
  createAtprotoAuthorizationUrl: mocks.createAtprotoAuthorizationUrl,
  pruneAtprotoOAuthStores: mocks.pruneAtprotoOAuthStores,
}));

describe("routes/api/atproto/oauth/start", () => {
  beforeEach(() => {
    mocks.createAtprotoAuthorizationUrl.mockReset();
    mocks.pruneAtprotoOAuthStores.mockReset();
  });

  it("redirects to the ATProto authorization URL", async () => {
    mocks.createAtprotoAuthorizationUrl.mockResolvedValue(
      new URL("https://bsky.social/oauth/authorize?request_uri=abc"),
    );
    const routeModule = await import("@/routes/api/atproto/oauth/start");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({
      request: new Request(
        "https://atlas.test/api/atproto/oauth/start?handle=org.example&returnTo=/claim/org",
      ),
    })) as Response;

    expect(mocks.createAtprotoAuthorizationUrl).toHaveBeenCalledWith({
      handle: "org.example",
      returnTo: "/claim/org",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://bsky.social/oauth/authorize?request_uri=abc",
    );
  });

  it("leaves OAuth store pruning to the authorization service", async () => {
    mocks.createAtprotoAuthorizationUrl.mockResolvedValue(
      new URL("https://bsky.social/oauth/authorize?request_uri=abc"),
    );
    const routeModule = await import("@/routes/api/atproto/oauth/start");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    await handlers.GET({
      request: new Request(
        "https://atlas.test/api/atproto/oauth/start?handle=org.example&returnTo=/claim/org",
      ),
    });

    expect(mocks.pruneAtprotoOAuthStores).not.toHaveBeenCalled();
  });

  it("requires a handle", async () => {
    const routeModule = await import("@/routes/api/atproto/oauth/start");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({
      request: new Request("https://atlas.test/api/atproto/oauth/start"),
    })) as Response;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ATProto handle is required." });
  });
});
