// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { captureRouterRedirect } from "@/../tests/fixtures/routes/redirect-capture";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/dashboard", () => {
  it("redirects the legacy dashboard path to /home", async () => {
    const routeModule = await import("@/routes/dashboard");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    const beforeLoad = Route.options.beforeLoad;
    const captured = await captureRouterRedirect(() => beforeLoad());
    expect(captured.isRedirect).toBe(true);
    expect(captured.options.to).toBe("/home");
  });

  it("renders nothing for the route component (it is a redirect-only route)", async () => {
    const routeModule = await import("@/routes/dashboard");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const callable = Component as unknown as () => unknown;
    expect(callable()).toBe(null);
  });
});
