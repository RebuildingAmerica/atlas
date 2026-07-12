// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/billing/pages/auth/start-purchase-complete-page", () => ({
  StartPurchaseCompletePage: ({ purchase }: { purchase?: string }) => (
    <div data-testid="start-purchase-complete-page" data-purchase={purchase ?? ""} />
  ),
  startPurchaseCompleteSearchSchema: { __schema: "start-complete" },
}));

vi.mock("@/domains/access/server", () => ({
  redirectIfLocalSession: vi.fn(),
}));

describe("routes/_auth/start/complete", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const access = await import("@/domains/access/server");
    vi.mocked(access.redirectIfLocalSession).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers the complete search schema and local-mode guard", async () => {
    const routeModule = await import("@/routes/_auth/start/complete");
    const { startPurchaseCompleteSearchSchema } =
      await import("@/domains/billing/pages/auth/start-purchase-complete-page");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.validateSearch).toBe(startPurchaseCompleteSearchSchema);
    Route.options.beforeLoad?.({});
    expect(access.redirectIfLocalSession).toHaveBeenCalledWith("/discovery");
  });

  it("passes the purchase id into the completion page", async () => {
    const routeModule = await import("@/routes/_auth/start/complete");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    readRouterMocks().useSearch.mockReturnValue({ purchase: "pi_123" });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected route component");
    const view = render(<Component />);

    expect(view.getByTestId("start-purchase-complete-page").dataset.purchase).toBe("pi_123");
  });
});
