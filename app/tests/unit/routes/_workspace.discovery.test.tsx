// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/discovery", () => ({
  DiscoveryPage: () => null,
}));

describe("routes/_workspace/discovery", () => {
  it("registers DiscoveryPage and disables SSR", async () => {
    const routeModule = await import("@/routes/_workspace/discovery");
    const { DiscoveryPage } = await import("@/domains/discovery");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.component).toBe(DiscoveryPage);
    expect(Route.options.ssr).toBe(false);
  });
});
