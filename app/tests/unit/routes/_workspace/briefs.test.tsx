// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasBriefCollection } from "@/domains/workspace/server/briefs";

const mocks = vi.hoisted(() => ({
  loadWorkspaceBriefs: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/server/briefs", () => ({
  loadWorkspaceBriefs: mocks.loadWorkspaceBriefs,
}));

vi.mock("@/domains/workspace/pages/brief-list-page", () => ({
  BriefListPage: ({ briefCollection }: { briefCollection: AtlasBriefCollection }) => (
    <div data-testid="brief-list" data-total={briefCollection.total} />
  ),
}));

describe("routes/_workspace/briefs", () => {
  function briefCollection(): AtlasBriefCollection {
    return {
      items: [],
      total: 0,
    };
  }

  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.loadWorkspaceBriefs.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads workspace briefs through the server helper", async () => {
    const data = briefCollection();
    mocks.loadWorkspaceBriefs.mockResolvedValue(data);

    const routeModule = await import("@/routes/_workspace/briefs");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const result = (await Route.options.loader({})) as {
      briefCollection: AtlasBriefCollection;
    };

    expect(result.briefCollection).toBe(data);
    expect(mocks.loadWorkspaceBriefs).toHaveBeenCalledWith();
  });

  it("sets the workspace briefs page title", async () => {
    const routeModule = await import("@/routes/_workspace/briefs");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.head?.({})).toEqual({
      meta: [{ title: "Atlas Briefs | Atlas" }],
    });
  });

  it("renders the brief list page with loader data", async () => {
    const routeModule = await import("@/routes/_workspace/briefs");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    readRouterMocks().useLoaderData.mockReturnValue({ briefCollection: briefCollection() });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("brief-list")).toHaveAttribute("data-total", "0");
  });
});
