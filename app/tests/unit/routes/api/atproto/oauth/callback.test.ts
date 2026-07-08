import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeAtprotoAuthorization: vi.fn(),
  pruneAtprotoOAuthStores: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/atproto-oauth", () => ({
  completeAtprotoAuthorization: mocks.completeAtprotoAuthorization,
  pruneAtprotoOAuthStores: mocks.pruneAtprotoOAuthStores,
}));

describe("routes/api/atproto/oauth/callback", () => {
  beforeEach(() => {
    mocks.completeAtprotoAuthorization.mockReset();
    mocks.pruneAtprotoOAuthStores.mockReset();
  });

  it("completes ATProto OAuth and redirects back to profile verification", async () => {
    mocks.completeAtprotoAuthorization.mockResolvedValue(
      "https://atlas.test/claim/org?atprotoIdentityId=identity_1&atprotoHandle=org.example",
    );
    const routeModule = await import("@/routes/api/atproto/oauth/callback");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({
      request: new Request("https://atlas.test/api/atproto/oauth/callback?code=c&state=s"),
    })) as Response;

    const params = mocks.completeAtprotoAuthorization.mock.calls[0]?.[0] as URLSearchParams;
    expect(params.get("code")).toBe("c");
    expect(params.get("state")).toBe("s");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://atlas.test/claim/org?atprotoIdentityId=identity_1&atprotoHandle=org.example",
    );
  });

  it("leaves OAuth store pruning to the callback service", async () => {
    mocks.completeAtprotoAuthorization.mockResolvedValue("https://atlas.test/claim/org");
    const routeModule = await import("@/routes/api/atproto/oauth/callback");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    await handlers.GET({
      request: new Request("https://atlas.test/api/atproto/oauth/callback?code=c&state=s"),
    });

    expect(mocks.pruneAtprotoOAuthStores).not.toHaveBeenCalled();
  });

  it("redirects recoverable failures back to profile verification", async () => {
    mocks.completeAtprotoAuthorization.mockRejectedValue(
      Object.assign(new Error("ATProto identity could not be verified."), {
        attemptedHandle: "org.example",
        returnTo: "/claim/org",
      }),
    );
    const routeModule = await import("@/routes/api/atproto/oauth/callback");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({
      request: new Request("https://atlas.test/api/atproto/oauth/callback?code=c&state=s"),
    })) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://atlas.test/claim/org?atprotoError=ATProto+identity+could+not+be+verified.&atprotoHandle=org.example",
    );
  });
});
