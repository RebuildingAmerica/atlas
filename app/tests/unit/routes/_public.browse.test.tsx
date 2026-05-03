// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog", () => ({
  BrowsePage: ({ search }: { search: unknown }) => (
    <div data-testid="browse-page" data-search={JSON.stringify(search)} />
  ),
  browseSearchSchema: {
    parse: (input: unknown) => input,
  },
}));

describe("routes/_public/browse", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers the browse search schema and disables SSR", async () => {
    const routeModule = await import("@/routes/_public/browse");
    const { browseSearchSchema } = await import("@/domains/catalog");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.ssr).toBe(false);
    expect(Route.options.validateSearch).toBe(browseSearchSchema);
  });

  it("renders BrowsePage with the search params from useSearch", async () => {
    const routeModule = await import("@/routes/_public/browse");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ query: "hello", offset: 0 });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    const node = view.getByTestId("browse-page");
    expect(node.dataset.search).toBe(JSON.stringify({ query: "hello", offset: 0 }));
  });
});
