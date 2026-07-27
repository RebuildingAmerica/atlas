import { describe, expect, it, vi } from "vitest";
import { callRouteGet } from "@/../tests/helpers/routes-server-handler";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/atproto-oauth", () => ({
  getAtprotoClientMetadata: vi.fn(() => ({
    client_id: "https://atlas.test/api/atproto/oauth/client-metadata.json",
    dpop_bound_access_tokens: true,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: ["https://atlas.test/api/atproto/oauth/callback"],
    response_types: ["code"],
    scope: "atproto",
  })),
}));

describe("routes/api/atproto/oauth/client-metadata.json", () => {
  it("returns the ATProto OAuth client metadata", async () => {
    const routeModule = await import("@/routes/api/atproto/oauth/client-metadata[.]json");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const response = (await handlers.GET({})) as Response;

    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual({
      client_id: "https://atlas.test/api/atproto/oauth/client-metadata.json",
      dpop_bound_access_tokens: true,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["https://atlas.test/api/atproto/oauth/callback"],
      response_types: ["code"],
      scope: "atproto",
    });
  });

  it("refuses to read client metadata outside the server", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/atproto/oauth/client-metadata[.]json");

    await expect(callRouteGet(routeModule.Route)).rejects.toThrow(
      "ATProto client metadata is only available on the server.",
    );
  });
});
