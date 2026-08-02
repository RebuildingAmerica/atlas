import { beforeEach, describe, expect, it, vi } from "vitest";
import { callRouteGet } from "@/../tests/helpers/routes-server-handler";

const mocks = vi.hoisted(() => ({
  createAtprotoSignInAuthorizationUrl: vi.fn(),
  isAtprotoSignInHarnessAuthorized: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/atproto-oauth", () => ({
  createAtprotoSignInAuthorizationUrl: mocks.createAtprotoSignInAuthorizationUrl,
}));

vi.mock("@/domains/access/server/hosted-e2e", () => ({
  isAtprotoSignInHarnessAuthorized: mocks.isAtprotoSignInHarnessAuthorized,
}));

describe("routes/api/atproto/sign-in/start", () => {
  // Block body on purpose: an expression body returns the mock itself, which
  // Vitest then treats as this hook's teardown callback and calls after every
  // test.
  beforeEach(() => {
    mocks.createAtprotoSignInAuthorizationUrl.mockReset();
    mocks.isAtprotoSignInHarnessAuthorized.mockReset();
    mocks.isAtprotoSignInHarnessAuthorized.mockReturnValue(false);
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
      useE2EHarness: false,
    });
  });

  it("uses the provider harness only for an authorized hosted proof request", async () => {
    mocks.isAtprotoSignInHarnessAuthorized.mockReturnValue(true);
    mocks.createAtprotoSignInAuthorizationUrl.mockResolvedValue(
      new URL("https://atlas.test/api/atproto/oauth/harness/authorize"),
    );
    const routeModule = await import("@/routes/api/atproto/sign-in/start");
    const request = new Request(
      "https://atlas.test/api/atproto/sign-in/start?handle=person.example",
      { headers: { "x-atlas-hosted-e2e-secret": "secret" } }, // pragma: allowlist secret
    );

    const response = await callRouteGet(routeModule.Route, request);

    expect(response.headers.get("location")).toBe(
      "https://atlas.test/api/atproto/oauth/harness/authorize",
    );
    expect(mocks.isAtprotoSignInHarnessAuthorized).toHaveBeenCalledWith(request);
    expect(mocks.createAtprotoSignInAuthorizationUrl).toHaveBeenCalledWith({
      handle: "person.example",
      returnTo: "/account",
      useE2EHarness: true,
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
      useE2EHarness: false,
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
