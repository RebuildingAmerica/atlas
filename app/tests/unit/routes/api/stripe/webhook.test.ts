import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/billing/server/webhook-handler", () => ({
  handleStripeWebhook: vi.fn((request: Request) =>
    Promise.resolve(new Response(`stripe:${request.method}`)),
  ),
}));

describe("routes/api/stripe/webhook", () => {
  it("forwards POST requests to handleStripeWebhook", async () => {
    const { handleStripeWebhook } = await import("@/domains/billing/server/webhook-handler");
    const routeModule = await import("@/routes/api/stripe/webhook");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const handlers = Route.options.server?.handlers;
    if (!handlers?.POST) throw new Error("Expected POST handler");

    const request = new Request("https://atlas.test/api/stripe/webhook", { method: "POST" });
    const response = (await handlers.POST({ request })) as Response;
    expect(handleStripeWebhook).toHaveBeenCalledWith(request);
    expect(await response.text()).toBe("stripe:POST");
  });
});
