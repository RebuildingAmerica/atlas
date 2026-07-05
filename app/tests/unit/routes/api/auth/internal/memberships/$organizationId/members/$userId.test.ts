import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server/internal-membership", () => ({
  verifyMembershipRequest: vi.fn((_request: Request, organizationId: string, userId: string) =>
    Promise.resolve(new Response(`verified:${organizationId}:${userId}`)),
  ),
}));

describe("routes/api/auth/internal/memberships/$organizationId/members/$userId", () => {
  it("delegates GET to verifyMembershipRequest with the URL params", async () => {
    const { verifyMembershipRequest } = await import("@/domains/access/server/internal-membership");
    const routeModule =
      await import("@/routes/api/auth/internal/memberships/$organizationId/members/$userId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.GET) throw new Error("Expected GET handler");

    const request = new Request(
      "https://atlas.test/api/auth/internal/memberships/org_1/members/u1",
    );
    const response = (await handlers.GET({
      request,
      params: { organizationId: "org_1", userId: "u1" },
    })) as Response;
    expect(verifyMembershipRequest).toHaveBeenCalledWith(request, "org_1", "u1");
    expect(await response.text()).toBe("verified:org_1:u1");
  });
});
