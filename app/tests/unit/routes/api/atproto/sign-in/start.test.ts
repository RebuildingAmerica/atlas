import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAtprotoSignInAuthorizationUrl: vi.fn() }));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/atproto-oauth", () => ({
  createAtprotoSignInAuthorizationUrl: mocks.createAtprotoSignInAuthorizationUrl,
}));

describe("routes/api/atproto/sign-in/start", () => {
  beforeEach(() => mocks.createAtprotoSignInAuthorizationUrl.mockReset());

  it("starts ATProto sign-in for a submitted handle", async () => {
    mocks.createAtprotoSignInAuthorizationUrl.mockResolvedValue(
      new URL("https://pds.example/oauth/authorize"),
    );
    const routeModule = await import("@/routes/api/atproto/sign-in/start");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const handlers = asRouteStub(routeModule.Route).options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({
      request: new Request("https://atlas.test/api/atproto/sign-in/start?handle=person.example"),
    })) as Response;

    expect(response.headers.get("location")).toBe("https://pds.example/oauth/authorize");
    expect(mocks.createAtprotoSignInAuthorizationUrl).toHaveBeenCalledWith({
      handle: "person.example",
      returnTo: "/account",
    });
  });

  it("normalizes username examples with a leading at sign", async () => {
    mocks.createAtprotoSignInAuthorizationUrl.mockResolvedValue(
      new URL("https://pds.example/oauth/authorize"),
    );
    const routeModule = await import("@/routes/api/atproto/sign-in/start");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const handlers = asRouteStub(routeModule.Route).options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    await handlers.GET({
      request: new Request("https://atlas.test/api/atproto/sign-in/start?handle=@GWashington.org"),
    });

    expect(mocks.createAtprotoSignInAuthorizationUrl).toHaveBeenCalledWith({
      handle: "gwashington.org",
      returnTo: "/account",
    });
  });
});
