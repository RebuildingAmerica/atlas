import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: vi.fn(),
}));

vi.mock("@/domains/access/server/cimd-handler", () => ({
  handleCimdRequest: vi.fn(),
}));

vi.mock("@/domains/access/server/oauth-token-resource-guard", () => ({
  enforceOAuthTokenResourceConsistency: vi.fn(),
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getCimdResolverOptions: vi.fn(() => ({ allowedOrigins: ["https://atlas.test"] })),
}));

vi.mock("@/domains/access/server/scout-token", () => ({
  issueScoutTokenRequest: vi.fn(),
}));

describe("routes/api/auth/$ Better Auth dispatcher", () => {
  it("returns the CIMD error response without invoking Better Auth", async () => {
    const { handleCimdRequest } = await import("@/domains/access/server/cimd-handler");
    const cimdResponse = new Response("cimd error", { status: 400 });
    vi.mocked(handleCimdRequest).mockResolvedValue({
      errorResponse: cimdResponse,
      request: new Request("https://atlas.test/api/auth/x"),
    });

    const routeModule = await import("@/routes/api/auth/$");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({
      request: new Request("https://atlas.test/api/auth/whatever"),
    })) as Response;
    expect(response).toBe(cimdResponse);
  });

  it("dispatches POST requests through Better Auth's handler", async () => {
    const { handleCimdRequest } = await import("@/domains/access/server/cimd-handler");
    const { ensureAuthReady } = await import("@/domains/access/server/auth");
    const { enforceOAuthTokenResourceConsistency } =
      await import("@/domains/access/server/oauth-token-resource-guard");
    const rewritten = new Request("https://atlas.test/api/auth/normalized", {
      method: "POST",
    });
    vi.mocked(handleCimdRequest).mockResolvedValue({
      errorResponse: null,
      request: rewritten,
    });
    const handler = vi.fn().mockResolvedValue(new Response("ok"));
    vi.mocked(ensureAuthReady).mockResolvedValue({
      handler,
    } as unknown as Awaited<ReturnType<typeof ensureAuthReady>>);
    vi.mocked(enforceOAuthTokenResourceConsistency).mockResolvedValue(null);

    const routeModule = await import("@/routes/api/auth/$");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");

    const response = (await handlers.POST({
      request: new Request("https://atlas.test/api/auth/whatever", { method: "POST" }),
    })) as Response;
    expect(enforceOAuthTokenResourceConsistency).toHaveBeenCalledWith(rewritten, {
      handler,
    });
    expect(handler).toHaveBeenCalledWith(rewritten);
    expect(await response.text()).toBe("ok");
  });

  it("returns a token resource guard error without invoking Better Auth", async () => {
    const { handleCimdRequest } = await import("@/domains/access/server/cimd-handler");
    const { ensureAuthReady } = await import("@/domains/access/server/auth");
    const { enforceOAuthTokenResourceConsistency } =
      await import("@/domains/access/server/oauth-token-resource-guard");
    const rewritten = new Request("https://atlas.test/api/auth/oauth2/token", {
      method: "POST",
    });
    vi.mocked(handleCimdRequest).mockResolvedValue({
      errorResponse: null,
      request: rewritten,
    });
    const handler = vi.fn().mockResolvedValue(new Response("ok"));
    vi.mocked(ensureAuthReady).mockResolvedValue({
      handler,
    } as unknown as Awaited<ReturnType<typeof ensureAuthReady>>);
    const guardResponse = new Response("resource mismatch", { status: 400 });
    vi.mocked(enforceOAuthTokenResourceConsistency).mockResolvedValue(guardResponse);

    const routeModule = await import("@/routes/api/auth/$");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");

    const response = (await handlers.POST({
      request: new Request("https://atlas.test/api/auth/oauth2/token", { method: "POST" }),
    })) as Response;

    expect(response).toBe(guardResponse);
    expect(handler).not.toHaveBeenCalled();
  });

  it("issues a Scout token without running the Better Auth handler", async () => {
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");
    vi.mocked(issueScoutTokenRequest).mockResolvedValue(
      Response.json({ token: "scout_1" }, { status: 201 }),
    );
    const { ensureAuthReady } = await import("@/domains/access/server/auth");
    const routeModule = await import("@/routes/api/auth/$");
    const { callRouteGet } = await import("@/../tests/helpers/routes-server-handler");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/auth/scout/token", { method: "GET" }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ token: "scout_1" });
    expect(ensureAuthReady).not.toHaveBeenCalled();
  });

  it("refuses to handle auth routes outside the server", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/auth/$");
    const { callRouteGet } = await import("@/../tests/helpers/routes-server-handler");

    await expect(
      callRouteGet(routeModule.Route, new Request("https://atlas.test/api/auth/session")),
    ).rejects.toThrow("Auth route handling is only available on the server.");
  });
});
