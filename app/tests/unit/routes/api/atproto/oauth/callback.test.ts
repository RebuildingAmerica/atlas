import { beforeEach, describe, expect, it, vi } from "vitest";
import { callRouteGet } from "@/../tests/helpers/routes-server-handler";

const mocks = vi.hoisted(() => ({
  completeAtprotoAuthorization: vi.fn(),
  completeAtprotoOAuthCallback: vi.fn(),
  parseAtprotoReturnTo: vi.fn(),
  pruneAtprotoOAuthStores: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/atproto-oauth", () => ({
  completeAtprotoAuthorization: mocks.completeAtprotoAuthorization,
  completeAtprotoOAuthCallback: mocks.completeAtprotoOAuthCallback,
  parseAtprotoReturnTo: mocks.parseAtprotoReturnTo,
  pruneAtprotoOAuthStores: mocks.pruneAtprotoOAuthStores,
}));

describe("routes/api/atproto/oauth/callback", () => {
  beforeEach(() => {
    mocks.completeAtprotoAuthorization.mockReset();
    mocks.completeAtprotoOAuthCallback.mockReset();
    mocks.parseAtprotoReturnTo.mockReset();
    mocks.pruneAtprotoOAuthStores.mockReset();
  });

  it("completes ATProto OAuth and redirects back to profile verification", async () => {
    mocks.completeAtprotoOAuthCallback.mockResolvedValue(
      Response.redirect(
        "https://atlas.test/claim/org?atprotoIdentityId=identity_1&atprotoHandle=org.example",
        302,
      ),
    );
    const routeModule = await import("@/routes/api/atproto/oauth/callback");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({
      request: new Request("https://atlas.test/api/atproto/oauth/callback?code=c&state=s"),
    })) as Response;

    const params = mocks.completeAtprotoOAuthCallback.mock.calls[0]?.[0] as URLSearchParams;
    expect(params.get("code")).toBe("c");
    expect(params.get("state")).toBe("s");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://atlas.test/claim/org?atprotoIdentityId=identity_1&atprotoHandle=org.example",
    );
  });

  it("leaves OAuth store pruning to the callback service", async () => {
    mocks.completeAtprotoOAuthCallback.mockResolvedValue(
      Response.redirect("https://atlas.test/claim/org", 302),
    );
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
    mocks.completeAtprotoOAuthCallback.mockRejectedValue(
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

  it("keeps the visitor's return path when the failure named no handle", async () => {
    mocks.completeAtprotoOAuthCallback.mockImplementation(() => {
      throw Object.assign(new Error("State expired."), { returnTo: "/claim/org" });
    });
    const routeModule = await import("@/routes/api/atproto/oauth/callback");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/oauth/callback?code=c&state=s"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://atlas.test/claim/org?atprotoError=State+expired.",
    );
  });

  it("names the failure generically when the error carried no message", async () => {
    mocks.completeAtprotoOAuthCallback.mockImplementation(() => {
      throw Object.assign(new Error(""), { returnTo: "/claim/org" });
    });
    const routeModule = await import("@/routes/api/atproto/oauth/callback");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/oauth/callback?code=c&state=s"),
    );

    expect(response.headers.get("location")).toBe(
      "https://atlas.test/claim/org?atprotoError=ATProto+callback+failed.",
    );
  });

  it("refuses to follow a return path the identity service will not vouch for", async () => {
    mocks.parseAtprotoReturnTo.mockImplementation(() => {
      throw new Error("Return path is not an Atlas page.");
    });
    mocks.completeAtprotoOAuthCallback.mockImplementation(() => {
      throw Object.assign(new Error("Handle mismatch."), { returnTo: "https://evil.test/steal" });
    });
    const routeModule = await import("@/routes/api/atproto/oauth/callback");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/oauth/callback?code=c&state=s"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Handle mismatch." });
  });

  it("answers with the failure reason when there is nowhere to send the visitor", async () => {
    mocks.completeAtprotoOAuthCallback.mockImplementation(() => {
      throw new Error("Authorization code was already used.");
    });
    const routeModule = await import("@/routes/api/atproto/oauth/callback");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/oauth/callback?code=c&state=s"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Authorization code was already used." });
  });

  it("answers generically when the failure was not an error at all", async () => {
    mocks.completeAtprotoOAuthCallback.mockImplementation(() => {
      // A rejected value that is not an Error is exactly what this covers.
      const failure: unknown = "dropped";
      throw failure;
    });
    const routeModule = await import("@/routes/api/atproto/oauth/callback");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/oauth/callback?code=c&state=s"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ATProto callback failed." });
  });

  it("refuses to run outside the server", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/atproto/oauth/callback");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/oauth/callback?code=c&state=s"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "ATProto OAuth is only available on the server.",
    });
    expect(mocks.completeAtprotoOAuthCallback).not.toHaveBeenCalled();
  });
});
