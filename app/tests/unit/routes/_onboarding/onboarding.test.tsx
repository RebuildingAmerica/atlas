// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/onboarding/pages/setup-page", () => ({
  SetupPage: ({
    interval,
    product,
    purchase,
  }: {
    interval?: string;
    product?: string;
    purchase?: string;
  }) => (
    <div
      data-testid="setup-page"
      data-interval={interval ?? ""}
      data-product={product ?? ""}
      data-purchase={purchase ?? ""}
    />
  ),
  setupSearchSchema: { __schema: "setup" },
}));

vi.mock("@/domains/access/server", () => ({
  redirectIfLocalSession: vi.fn(),
}));

describe("routes/_onboarding/onboarding", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const access = await import("@/domains/access/server");
    vi.mocked(access.redirectIfLocalSession).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers the setup search schema and local-mode guard", async () => {
    const parentRouteModule = await import("@/routes/_onboarding/onboarding");
    const indexRouteModule = await import("@/routes/_onboarding/onboarding/index");
    const { setupSearchSchema } = await import("@/domains/onboarding/pages/setup-page");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const ParentRoute = asRouteStub(parentRouteModule.Route);
    const IndexRoute = asRouteStub(indexRouteModule.Route);

    expect(IndexRoute.options.validateSearch).toBe(setupSearchSchema);
    ParentRoute.options.beforeLoad?.({});
    expect(access.redirectIfLocalSession).toHaveBeenCalledWith("/discovery");
  });

  it("hands the onboarding shell over to its child step", async () => {
    const routeModule = await import("@/routes/_onboarding/onboarding");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected route component");

    const view = render(<Component />);

    expect(view.getByTestId("router-outlet")).toBeInTheDocument();
  });

  it("passes product, interval, and purchase search params into the page", async () => {
    const routeModule = await import("@/routes/_onboarding/onboarding/index");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    readRouterMocks().useSearch.mockReturnValue({
      interval: "monthly",
      product: "atlas_team",
      purchase: "pi_123",
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected route component");
    const view = render(<Component />);

    const node = view.getByTestId("setup-page");
    expect(node.dataset.product).toBe("atlas_team");
    expect(node.dataset.interval).toBe("monthly");
    expect(node.dataset.purchase).toBe("pi_123");
  });
});
