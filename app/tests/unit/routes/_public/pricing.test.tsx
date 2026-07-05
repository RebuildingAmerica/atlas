// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/billing/pages/public/pricing-page", () => ({
  PricingPage: ({ intent, interval }: { intent?: string; interval?: string }) => (
    <div data-testid="pricing-page" data-intent={intent ?? ""} data-interval={interval ?? ""} />
  ),
  pricingSearchSchema: { __schema: "pricing" },
}));

vi.mock("@/domains/access/server", () => ({
  redirectIfLocalSession: vi.fn(),
}));

describe("routes/_public/pricing", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const access = await import("@/domains/access/server");
    vi.mocked(access.redirectIfLocalSession).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers the pricing search schema and redirects local sessions to /", async () => {
    const routeModule = await import("@/routes/_public/pricing");
    const { pricingSearchSchema } = await import("@/domains/billing/pages/public/pricing-page");
    const access = await import("@/domains/access/server");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.validateSearch).toBe(pricingSearchSchema);
    if (!Route.options.beforeLoad) throw new Error("Expected beforeLoad");
    Route.options.beforeLoad({});
    expect(access.redirectIfLocalSession).toHaveBeenCalledWith("/");
  });

  it("publishes SEO metadata for the public pricing page", async () => {
    const routeModule = await import("@/routes/_public/pricing");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const head = Route.options.head?.({}) as {
      meta: Record<string, string>[];
      links: Record<string, string>[];
    };

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Pricing | Atlas" },
        {
          name: "description",
          content:
            "Choose Atlas access for individual research, team workflows, and civic data reuse.",
        },
        { property: "og:url", content: "https://atlas.rebuildingamerica.com/pricing" },
        { name: "twitter:card", content: "summary_large_image" },
      ]),
    );
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/pricing",
    });
  });

  it("forwards search intent and interval into PricingPage", async () => {
    const routeModule = await import("@/routes/_public/pricing");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ intent: "team-sso", interval: "annual" });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    const node = view.getByTestId("pricing-page");
    expect(node.dataset.intent).toBe("team-sso");
    expect(node.dataset.interval).toBe("annual");
  });
});
