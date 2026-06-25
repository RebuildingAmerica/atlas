// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

const mocks = vi.hoisted(() => ({ loadMapPoints: vi.fn() }));

vi.mock("@/domains/catalog", () => ({
  MapPage: ({ search, initialPoints }: { search: unknown; initialPoints: unknown }) => (
    <div
      data-testid="map-page"
      data-search={JSON.stringify(search)}
      data-seeded={JSON.stringify(initialPoints)}
    />
  ),
  mapSearchSchema: { parse: (input: unknown) => input },
}));

vi.mock("@/domains/catalog/server/map-points", () => ({
  loadMapPoints: mocks.loadMapPoints,
}));

beforeEach(async () => {
  const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
  resetRouterMocks();
  mocks.loadMapPoints.mockReset();
});

afterEach(cleanup);

describe("routes/_public/map", () => {
  it("registers the map search schema and disables SSR for the WebGL canvas", async () => {
    const routeModule = await import("@/routes/_public/map");
    const { mapSearchSchema } = await import("@/domains/catalog");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.ssr).toBe(false);
    expect(Route.options.validateSearch).toBe(mapSearchSchema);
  });

  it("keys the loader on the search so a filter change reseeds the dots", async () => {
    const routeModule = await import("@/routes/_public/map");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const loaderDeps = Route.options.loaderDeps;
    if (!loaderDeps) throw new Error("Expected Route.options.loaderDeps");
    expect(loaderDeps({ search: { query: "tenants" } })).toEqual({
      search: { query: "tenants" },
    });
  });

  it("seeds the continental-US points from the route's filters in the loader", async () => {
    const routeModule = await import("@/routes/_public/map");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const seeded = { points: [], total: 0, capped: false };
    mocks.loadMapPoints.mockResolvedValue(seeded);

    const loader = Route.options.loader;
    if (!loader) throw new Error("Expected Route.options.loader");
    const result = await loader({
      deps: { search: { issue_areas: "housing-affordability", states: "TX", query: "q" } },
    });

    expect(result).toEqual({ initialPoints: seeded });
    expect(mocks.loadMapPoints).toHaveBeenCalledWith({
      data: {
        query: "q",
        states: ["TX"],
        cities: [],
        regions: [],
        issue_areas: ["housing-affordability"],
        entry_types: [],
        source_types: [],
      },
    });
  });

  it("renders MapPage with the search params and the seeded points", async () => {
    const routeModule = await import("@/routes/_public/map");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ issue_areas: "housing-affordability" });
    router.useLoaderData.mockReturnValue({
      initialPoints: { points: [], total: 0, capped: false },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    const node = view.getByTestId("map-page");
    expect(node.dataset.search).toBe(JSON.stringify({ issue_areas: "housing-affordability" }));
    expect(node.dataset.seeded).toBe(JSON.stringify({ points: [], total: 0, capped: false }));
  });
});
