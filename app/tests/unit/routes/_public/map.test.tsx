// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import type { PageHead } from "@/platform/seo";
import type * as CatalogSearchState from "@/domains/catalog/search-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

const mocks = vi.hoisted(() => ({ loadMapPoints: vi.fn() }));

vi.mock("@/domains/catalog", () => {
  throw new Error("Map route should import direct map modules instead of the catalog barrel");
});

vi.mock("@/domains/catalog/components/map/map-page", () => ({
  MapPage: ({
    search,
    initialPoints,
    initialPointsLoadFailed,
  }: {
    initialPoints: unknown;
    initialPointsLoadFailed?: boolean;
    search: unknown;
  }) => (
    <div
      data-testid="map-page"
      data-search={JSON.stringify(search)}
      data-seeded={JSON.stringify(initialPoints)}
      data-load-failed={String(initialPointsLoadFailed ?? false)}
    />
  ),
}));

vi.mock("@/domains/catalog/search-state", async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogSearchState>();
  return {
    ...actual,
    mapSearchSchema: { parse: (input: unknown) => input },
  };
});

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
    const { mapSearchSchema } = await import("@/domains/catalog/search-state");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.ssr).toBe(false);
    expect(Route.options.validateSearch).toBe(mapSearchSchema);
  });

  it("publishes metadata even though the WebGL map surface is client-rendered", async () => {
    const routeModule = await import("@/routes/_public/map");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const head = Route.options.head?.({}) as PageHead;

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Civic Map | Atlas" },
        {
          name: "description",
          content: "Map people and groups by place, issue, and source.",
        },
        {
          property: "og:url",
          content: "https://atlas.rebuildingamerica.com/map",
        },
        {
          property: "og:image",
          content: "https://atlas.rebuildingamerica.com/social/atlas-card.png",
        },
        { name: "twitter:card", content: "summary_large_image" },
      ]),
    );
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/map",
    });
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
      deps: {
        search: {
          issue_areas: "housing-affordability",
          source_patterns: "multi_source",
          states: "TX",
          query: "q",
        },
      },
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
        source_patterns: ["multi_source"],
      },
    });
  });

  it("keeps the map route mounted when the initial points request is unavailable", async () => {
    const routeModule = await import("@/routes/_public/map");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    mocks.loadMapPoints.mockRejectedValue(new Error("Atlas is temporarily unavailable."));

    const loader = Route.options.loader;
    if (!loader) throw new Error("Expected Route.options.loader");
    const result = await loader({
      deps: {
        search: {},
      },
    });

    expect(result).toEqual({ initialPointsLoadFailed: true });
  });

  it("renders MapPage with the search params and the seeded points", async () => {
    const routeModule = await import("@/routes/_public/map");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ issue_areas: "housing-affordability" });
    router.useLoaderData.mockReturnValue({
      initialPoints: undefined,
      initialPointsLoadFailed: true,
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    const node = view.getByTestId("map-page");
    expect(node.dataset.search).toBe(JSON.stringify({ issue_areas: "housing-affordability" }));
    expect(node.dataset.seeded).toBeUndefined();
    expect(node.dataset.loadFailed).toBe("true");
  });
});
