// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/billing/pages/auth/start-purchase-page", () => ({
  StartPurchasePage: ({
    interval,
    product,
    purchase,
  }: {
    interval?: string;
    product?: string;
    purchase?: string;
  }) => (
    <div
      data-testid="start-purchase-page"
      data-interval={interval ?? ""}
      data-product={product ?? ""}
      data-purchase={purchase ?? ""}
    />
  ),
  startPurchaseSearchSchema: { __schema: "start" },
}));

vi.mock("@/domains/access/server", () => ({
  redirectIfLocalSession: vi.fn(),
}));

describe("routes/_auth/start", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const access = await import("@/domains/access/server");
    vi.mocked(access.redirectIfLocalSession).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers the start purchase search schema and local-mode guard", async () => {
    const routeModule = await import("@/routes/_auth/start");
    const { startPurchaseSearchSchema } =
      await import("@/domains/billing/pages/auth/start-purchase-page");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.validateSearch).toBe(startPurchaseSearchSchema);
    Route.options.beforeLoad?.({});
    expect(access.redirectIfLocalSession).toHaveBeenCalledWith("/discovery");
  });

  it("passes product, interval, and purchase search params into the page", async () => {
    const routeModule = await import("@/routes/_auth/start");
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

    const node = view.getByTestId("start-purchase-page");
    expect(node.dataset.product).toBe("atlas_team");
    expect(node.dataset.interval).toBe("monthly");
    expect(node.dataset.purchase).toBe("pi_123");
  });
});
