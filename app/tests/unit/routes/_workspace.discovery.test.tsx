// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/discovery", () => ({
  DiscoveryPage: vi.fn(() => null),
}));

vi.mock("@/domains/discovery/functions", () => ({
  listDiscoveryRuns: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    taxonomy: {
      list: vi.fn(),
    },
  },
}));

describe("routes/_workspace/discovery", () => {
  it("registers an SSR-friendly route with metadata", async () => {
    const routeModule = await import("@/routes/_workspace/discovery");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.component).toBeDefined();
    expect(Route.options.ssr).not.toBe(false);
    expect(Route.options.head?.({})).toEqual({
      meta: [
        {
          title: "Research | Atlas",
        },
        {
          name: "description",
          content: "Start source-linked local civic research and export reusable briefs.",
        },
      ],
    });
  });

  it("loads initial runs and taxonomy for SSR", async () => {
    const discovery = await import("@/domains/discovery/functions");
    const { api } = await import("@/lib/api");
    vi.mocked(discovery.listDiscoveryRuns).mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.mocked(api.taxonomy.list).mockResolvedValue({
      Housing: [{ name: "Housing affordability", slug: "housing_affordability", description: "" }],
    });

    const routeModule = await import("@/routes/_workspace/discovery");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    await expect(Route.options.loader()).resolves.toEqual({
      initialRuns: { items: [], total: 0 },
      initialTaxonomy: {
        Housing: [
          { name: "Housing affordability", slug: "housing_affordability", description: "" },
        ],
      },
    });
  });
});
