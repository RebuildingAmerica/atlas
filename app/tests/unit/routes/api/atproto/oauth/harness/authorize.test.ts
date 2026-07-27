import { beforeEach, describe, expect, it, vi } from "vitest";
import { callRouteGet } from "@/../tests/helpers/routes-server-handler";

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

  it("reports why the harness provider could not authorize", async () => {
    mocks.createAtprotoHarnessProviderCallbackUrl.mockImplementation(() => {
      throw new Error("Harness state is unknown.");
    });
    const routeModule = await import("@/routes/api/atproto/oauth/harness/authorize");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/oauth/harness/authorize?state=state_1"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Harness state is unknown." });
  });

  it("falls back to a plain failure message when the cause is not an error", async () => {
    mocks.createAtprotoHarnessProviderCallbackUrl.mockImplementation(() => {
      // A rejected value that is not an Error is exactly what this covers.
      const failure: unknown = "dropped";
      throw failure;
    });
    const routeModule = await import("@/routes/api/atproto/oauth/harness/authorize");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/oauth/harness/authorize?state=state_1"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ATProto provider failed." });
  });

  it("refuses to run outside the server", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/atproto/oauth/harness/authorize");

    const response = await callRouteGet(
      routeModule.Route,
      new Request("https://atlas.test/api/atproto/oauth/harness/authorize?state=state_1"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "ATProto OAuth is only available on the server.",
    });
    expect(mocks.createAtprotoHarnessProviderCallbackUrl).not.toHaveBeenCalled();
  });
});
