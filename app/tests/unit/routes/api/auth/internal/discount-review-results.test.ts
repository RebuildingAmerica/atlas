import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/billing/server/internal-discount-review-result", () => ({
  handleDiscountReviewResultRequest: vi.fn(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  ),
}));

describe("routes/api/auth/internal/discount-review-results", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hands the API's callback to the review-result handler", async () => {
    const { handleDiscountReviewResultRequest } =
      await import("@/domains/billing/server/internal-discount-review-result");
    const routeModule = await import("@/routes/api/auth/internal/discount-review-results");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const handlers = asRouteStub(routeModule.Route).options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");

    const request = new Request("https://atlas.test/api/auth/internal/discount-review-results", {
      method: "POST",
    });
    const response = (await handlers.POST({ request, params: {} })) as Response;

    expect(handleDiscountReviewResultRequest).toHaveBeenCalledWith(request);
    expect(response.status).toBe(204);
  });

  it("refuses to run outside the server bundle", async () => {
    vi.stubEnv("SSR", false);
    const routeModule = await import("@/routes/api/auth/internal/discount-review-results");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const handlers = asRouteStub(routeModule.Route).options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");

    await expect(
      handlers.POST({
        request: new Request("https://atlas.test/api/auth/internal/discount-review-results", {
          method: "POST",
        }),
        params: {},
      }),
    ).rejects.toThrow("only accepted on the server");
  });
});
