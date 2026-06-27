// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
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

vi.mock("@/lib/api", () => ({
  api: mocks.api,
}));

vi.mock("@/domains/catalog/search-state", () => ({
  buildBrowseSearch: mocks.buildBrowseSearch,
}));

vi.mock("@/domains/catalog", () => ({
  BrowsePage: (props: { initialEntries?: unknown; search: unknown }) => {
    mocks.browsePageProps(props);

    return <div data-testid="browse-page" data-search={JSON.stringify(props.search)} />;
  },
  browseSearchSchema: mocks.browseSearchSchema,
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
    const { browseSearchSchema } = await import("@/domains/catalog");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.ssr).not.toBe(false);
    expect(Route.options.validateSearch).toBe(browseSearchSchema);
    expect(Route.options.head?.({})).toEqual({
      meta: [
        { title: "Browse | Atlas" },
        {
          name: "description",
          content:
            "Browse source-linked civic actors by place, issue, source type, and public evidence.",
        },
      ],
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

  it("renders BrowsePage with the search params from useSearch", async () => {
    const routeModule = await import("@/routes/_public/browse");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ query: "hello", offset: 0 });
    router.useLoaderData.mockReturnValue({ initialEntries: { data: [] } });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    const node = view.getByTestId("browse-page");
    expect(node.dataset.search).toBe(JSON.stringify({ query: "hello", offset: 0 }));
    expect(mocks.browsePageProps).toHaveBeenCalledWith({
      initialEntries: { data: [] },
      search: { query: "hello", offset: 0 },
    });
  });
});
