// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/server", () => ({
  requireInstanceOperatorSession: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

describe("routes/_workspace/editorial layout", () => {
  it("lets only the instance's operators in, then renders the editorial page", async () => {
    const routeModule = await import("@/routes/_workspace/editorial");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    await Route.options.beforeLoad({ location: { href: "/editorial/schedules" } });
    expect(access.requireInstanceOperatorSession).toHaveBeenCalledWith("/editorial/schedules");

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByTestId("router-outlet")).toBeInTheDocument();
  });
});
