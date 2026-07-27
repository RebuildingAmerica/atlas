import { beforeEach, describe, expect, it, vi } from "vitest";
import { callRouteGet } from "@/../tests/helpers/routes-server-handler";

const mocks = vi.hoisted(() => ({ createAtprotoSignInAuthorizationUrl: vi.fn() }));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/atproto-oauth", () => ({
  createAtprotoSignInAuthorizationUrl: mocks.createAtprotoSignInAuthorizationUrl,
}));

describe("routes/api/atproto/sign-in/start", () => {
  // Block body on purpose: an expression body returns the mock itself, which
  // Vitest then treats as this hook's teardown callback and calls after every
  // test.
  beforeEach(() => {
    mocks.createAtprotoSignInAuthorizationUrl.mockReset();
  });

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

  it("asks for a handle before starting sign-in", async () => {
    const routeModule = await import("@/routes/api/atproto/sign-in/start");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/sign-in/start?handle=%20%20"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ATProto handle is required." });
    expect(mocks.createAtprotoSignInAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("keeps the reason for a failed sign-in start out of the reply", async () => {
    mocks.createAtprotoSignInAuthorizationUrl.mockImplementation(() => {
      throw new Error("PDS resolution failed for did:plc:xyz");
    });
    const routeModule = await import("@/routes/api/atproto/sign-in/start");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/sign-in/start?handle=person.example"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ATProto sign-in is unavailable." });
  });

  it("refuses to run outside the server", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/atproto/sign-in/start");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/sign-in/start?handle=person.example"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ATProto sign-in is unavailable." });
    expect(mocks.createAtprotoSignInAuthorizationUrl).not.toHaveBeenCalled();
  });
});
