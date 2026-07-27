// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import type { PageHead } from "@/platform/seo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    entries: {
      list: vi.fn(),
    },
  },
  browsePageProps: vi.fn(),
  buildBrowseSearch: vi.fn(),
  browseSearchSchema: {
    parse: vi.fn((input: unknown) => input),
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: mocks.api,
}));

vi.mock("@rebuildingamerica/atlas-catalog/search-state", () => ({
  buildBrowseSearch: mocks.buildBrowseSearch,
  browseSearchSchema: mocks.browseSearchSchema,
}));

vi.mock("@/domains/catalog", () => {
  throw new Error("Browse route should import direct browse modules instead of the catalog barrel");
});

vi.mock("@/domains/catalog/components/browse/browse-page", () => ({
  BrowsePage: (props: { initialEntries?: unknown; search: unknown }) => {
    mocks.browsePageProps(props);

    return <div data-testid="browse-page" data-search={JSON.stringify(props.search)} />;
  },
}));

describe("routes/_public/browse", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.api.entries.list.mockReset();
    mocks.browsePageProps.mockReset();
    mocks.buildBrowseSearch.mockReset();
    mocks.browseSearchSchema.parse.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers the browse search schema without opting out of SSR", async () => {
    const routeModule = await import("@/routes/_public/browse");
    const { browseSearchSchema } = await import("@rebuildingamerica/atlas-catalog/search-state");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.ssr).not.toBe(false);
    expect(Route.options.validateSearch).toBe(browseSearchSchema);
    const head = Route.options.head?.({}) as PageHead;

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Browse | Atlas" },
        {
          name: "description",
          content: "Find people and groups by place, issue, name, and source.",
        },
        {
          property: "og:url",
          content: "https://atlas.rebuildingamerica.com/browse",
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
      href: "https://atlas.rebuildingamerica.com/browse",
    });
  });

  it("keys the loader on the search so a filter change refetches the list", async () => {
    const routeModule = await import("@/routes/_public/browse");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const loaderDeps = Route.options.loaderDeps;
    if (!loaderDeps) throw new Error("Expected Route.options.loaderDeps");
    expect(loaderDeps({ search: { query: "tenant union", offset: 20 } })).toEqual({
      search: { query: "tenant union", offset: 20 },
    });
  });

  it("loads initial browse entries on the server from normalized search params", async () => {
    const routeModule = await import("@/routes/_public/browse");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const initialEntries = {
      data: [],
      facets: {
        cities: [],
        entity_types: [],
        issue_areas: [],
        regions: [],
        source_patterns: [],
        source_types: [],
        states: [],
      },
      pagination: { has_more: false, limit: 20, offset: 0, total: 0 },
    };
    mocks.buildBrowseSearch.mockReturnValue({
      cities: ["Kansas City"],
      entry_types: ["organization"],
      issue_areas: ["housing_affordability"],
      offset: 20,
      query: "tenant union",
      regions: [],
      source_patterns: ["multi_source"],
      source_types: ["news_article"],
      states: ["MO"],
      view: "map",
    });
    mocks.api.entries.list.mockResolvedValue(initialEntries);

    const loaderResult = await Route.options.loader?.({
      deps: {
        search: {
          entry_types: "organization",
          issue_areas: "housing_affordability",
          offset: 20,
          query: "tenant union",
          source_patterns: "multi_source",
          source_types: "news_article",
          states: "MO",
        },
      },
    });

    expect(mocks.api.entries.list).toHaveBeenCalledWith({
      cities: ["Kansas City"],
      entry_types: ["organization"],
      issue_areas: ["housing_affordability"],
      limit: 20,
      offset: 20,
      query: "tenant union",
      regions: [],
      source_patterns: ["multi_source"],
      source_types: ["news_article"],
      states: ["MO"],
    });
    expect(loaderResult).toEqual({ initialEntries });
  });

  it("keeps the browse route mounted when the initial entries request is unavailable", async () => {
    const routeModule = await import("@/routes/_public/browse");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    mocks.buildBrowseSearch.mockReturnValue({
      cities: [],
      entry_types: [],
      issue_areas: [],
      offset: 0,
      query: undefined,
      regions: [],
      source_patterns: [],
      source_types: [],
      states: [],
      view: "list",
    });
    mocks.api.entries.list.mockRejectedValue(new Error("Atlas is temporarily unavailable."));

    const loaderResult = await Route.options.loader?.({
      deps: {
        search: {},
      },
    });

    expect(loaderResult).toEqual({ initialEntriesLoadFailed: true });
  });

  it("keeps the browse route mounted when the initial entries request returns an HTTP 5xx", async () => {
    const routeModule = await import("@/routes/_public/browse");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const httpError = new Error("HTTPError") as Error & { status: number };
    httpError.name = "HTTPError";
    httpError.status = 502;
    mocks.buildBrowseSearch.mockReturnValue({
      cities: [],
      entry_types: [],
      issue_areas: [],
      offset: 0,
      query: undefined,
      regions: [],
      source_patterns: [],
      source_types: [],
      states: [],
      view: "list",
    });
    mocks.api.entries.list.mockRejectedValue(httpError);

    const loaderResult = await Route.options.loader?.({
      deps: {
        search: {},
      },
    });

    expect(loaderResult).toEqual({ initialEntriesLoadFailed: true });
  });

  it("surfaces a coding error from the browse loader instead of hiding it", async () => {
    const routeModule = await import("@/routes/_public/browse");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    mocks.buildBrowseSearch.mockReturnValue({
      cities: [],
      entry_types: [],
      issue_areas: [],
      offset: 0,
      query: undefined,
      regions: [],
      source_patterns: [],
      source_types: [],
      states: [],
      view: "list",
    });
    mocks.api.entries.list.mockRejectedValue(new TypeError("filters.cities is not iterable"));

    await expect(Route.options.loader?.({ deps: { search: {} } })).rejects.toThrow(
      "filters.cities is not iterable",
    );
  });

  it("renders BrowsePage with the search params from useSearch", async () => {
    const routeModule = await import("@/routes/_public/browse");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ query: "hello", offset: 0 });
    router.useLoaderData.mockReturnValue({
      initialEntries: undefined,
      initialEntriesLoadFailed: true,
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    const node = view.getByTestId("browse-page");
    expect(node.dataset.search).toBe(JSON.stringify({ query: "hello", offset: 0 }));
    expect(mocks.browsePageProps).toHaveBeenCalledWith({
      initialEntries: undefined,
      initialEntriesLoadFailed: true,
      search: { query: "hello", offset: 0 },
    });
  });
});
