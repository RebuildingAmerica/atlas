// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/onboarding/pages/setup-complete-page", () => ({
  purchaseOnboardingIntentQueryOptions: vi.fn((purchaseId: string) => ({
    queryKey: ["onboarding", "purchase-intent", purchaseId],
  })),
  SetupCompletePage: ({ purchase }: { purchase?: string }) => (
    <div data-testid="setup-complete-page" data-purchase={purchase ?? ""} />
  ),
  setupCompleteSearchSchema: { __schema: "setup-complete" },
}));

vi.mock("@/domains/access/server", () => ({
  redirectIfLocalSession: vi.fn(),
}));

describe("routes/_onboarding/onboarding/complete", () => {
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
    const routeModule = await import("@/routes/_onboarding/onboarding/complete");
    const { setupCompleteSearchSchema } =
      await import("@/domains/onboarding/pages/setup-complete-page");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.validateSearch).toBe(setupCompleteSearchSchema);
    Route.options.beforeLoad?.({});
    expect(access.redirectIfLocalSession).toHaveBeenCalledWith("/discovery");
  });

  it("keys the loader on the purchase id so a new return link refetches", async () => {
    const routeModule = await import("@/routes/_onboarding/onboarding/complete");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const loaderDeps = Route.options.loaderDeps;
    if (!loaderDeps) throw new Error("Expected loaderDeps");

    expect(loaderDeps({ search: { purchase: "pi_123" } })).toEqual({ purchase: "pi_123" });
    expect(loaderDeps({ search: {} })).toEqual({ purchase: undefined });
  });

  it("preloads purchase completion details when the return link carries a purchase", async () => {
    const routeModule = await import("@/routes/_onboarding/onboarding/complete");
    const setupPage = await import("@/domains/onboarding/pages/setup-complete-page");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const ensureQueryData = vi.fn().mockResolvedValue({
      id: "pi_123",
      product: "atlas_pro",
      status: "paid",
      workspaceId: "org_123",
    });

    if (!Route.options.loader) throw new Error("Expected loader");
    const result = await Route.options.loader({
      context: { queryClient: { ensureQueryData } },
      deps: { purchase: "pi_123" },
    });

    expect(setupPage.purchaseOnboardingIntentQueryOptions).toHaveBeenCalledWith("pi_123");
    expect(ensureQueryData).toHaveBeenCalledWith({
      queryKey: ["onboarding", "purchase-intent", "pi_123"],
    });
    expect(result).toEqual({
      id: "pi_123",
      product: "atlas_pro",
      status: "paid",
      workspaceId: "org_123",
    });
  });

  it("does not preload purchase completion details without a purchase id", async () => {
    const routeModule = await import("@/routes/_onboarding/onboarding/complete");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const ensureQueryData = vi.fn();

    if (!Route.options.loader) throw new Error("Expected loader");
    const result = Route.options.loader({
      context: { queryClient: { ensureQueryData } },
      deps: {},
    });

    expect(result).toBeNull();

    expect(ensureQueryData).not.toHaveBeenCalled();
  });

  it("passes the purchase id into the completion page", async () => {
    const routeModule = await import("@/routes/_onboarding/onboarding/complete");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    readRouterMocks().useSearch.mockReturnValue({ purchase: "pi_123" });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected route component");
    const view = render(<Component />);

    expect(view.getByTestId("setup-complete-page").dataset.purchase).toBe("pi_123");
  });
});
