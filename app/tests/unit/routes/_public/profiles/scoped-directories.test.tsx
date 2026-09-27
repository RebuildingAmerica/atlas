// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), browsePageProps: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const harness = await import("@/../tests/helpers/router-harness");
  return { ...(await importOriginal<object>()), ...harness.installRouterMocks() };
});

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: { entries: { list: mocks.list } },
}));

vi.mock("@/domains/catalog/components/browse/browse-page", () => ({
  BrowsePage: (props: unknown) => {
    mocks.browsePageProps(props);
    return <div data-testid="directory" />;
  },
}));

describe("scoped profile directories", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.list.mockReset();
    mocks.browsePageProps.mockReset();
  });

  afterEach(cleanup);

  const cases = [
    {
      title: "People",
      type: "person",
      route: () => import("@/routes/_public/profiles/people/index"),
    },
    {
      title: "Organizations",
      type: "organization",
      route: () => import("@/routes/_public/profiles/organizations/index"),
    },
  ] as const;

  it.each(cases)("$title route filters, paginates, and renders its directory", async (testCase) => {
    const { browseSearchSchema } = await import("@rebuildingamerica/atlas-catalog/search-state");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const { Route } = await testCase.route();
    const route = asRouteStub(Route);
    const search = { cities: "Las Vegas", issue_areas: "housing_affordability", offset: 20 };
    const response = { data: [], pagination: { total: 48 } };
    mocks.list.mockResolvedValue(response);

    expect(route.options.validateSearch).toBe(browseSearchSchema);
    const head = route.options.head?.({}) as { meta: { title?: string }[] };
    expect(head.meta).toContainEqual({
      title: `${testCase.title === "People" ? "People" : "Organization"} Profiles | Atlas`,
    });
    expect(head.meta).toContainEqual({
      name: "description",
      content: `Find ${testCase.title.toLowerCase()} by name, place, and issue, with linked sources and contact details where available.`,
    });
    expect(route.options.loaderDeps?.({ search })).toEqual({ search });
    await expect(route.options.loader?.({ deps: { search } })).resolves.toEqual({
      initialEntries: response,
    });
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        cities: ["Las Vegas"],
        entry_types: [testCase.type],
        issue_areas: ["housing_affordability"],
        limit: 20,
        offset: 20,
      }),
    );

    readRouterMocks().useSearch.mockReturnValue(search);
    readRouterMocks().useLoaderData.mockReturnValue({ initialEntries: response });
    const Component = route.options.component;
    if (!Component) throw new Error("Expected route component");
    render(<Component />);
    const pageProps = mocks.browsePageProps.mock.lastCall?.[0] as {
      initialEntries?: unknown;
      search: unknown;
      page: { lockedEntryTypes: string[]; title: string };
    };
    expect(pageProps.initialEntries).toBe(response);
    expect(pageProps.search).toBe(search);
    expect(pageProps.page).toMatchObject({
      lockedEntryTypes: [testCase.type],
      title: testCase.title,
    });
  });

  it.each(cases)("$title remains usable when server loading fails", async (testCase) => {
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const { Route } = await testCase.route();
    mocks.list.mockRejectedValue(new TypeError("fetch failed"));
    await expect(asRouteStub(Route).options.loader?.({ deps: { search: {} } })).resolves.toEqual({
      initialEntries: undefined,
    });
  });
});
